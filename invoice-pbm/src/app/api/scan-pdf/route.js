import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { extractText } from 'unpdf';

// Force Node.js runtime for this route (required for file buffers)
export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    
    // Extract text from PDF using unpdf (ESM-compatible)
    const { text: rawText } = await extractText(new Uint8Array(buffer), { mergePages: true });

    // Truncate text to reduce token usage (invoice key data is usually in first 4000 chars)
    const truncatedText = rawText.trim().slice(0, 4000);
    console.log(`PDF text length: ${rawText.length} chars, using first ${truncatedText.length} chars`);

    // Initialize Gemini AI
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-flash-lite-latest",
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const prompt = `You are an expert invoice data extractor. Extract data from this invoice text into a JSON object.
Rules:
- For 'clientName', extract the name of the Client/Company issuing this document (e.g., PT PELAYARAN...). DO NOT use "PUTRA BANUA MANDIRI CV" as the client name, as that is the vendor.
- For 'clientAddress', if you see the text "ALAMAT PENGIRIMAN BARANG", strictly use the address written there.
- 'price' must be a number (strip Rp/commas).
- 'tb' stands for Tugboat (e.g. TB KSA...). 'bg' stands for Barge (e.g. BG KSA...). 'desc' is any extra item description.
- 'type' is "rental" if it mentions sewa/rental, otherwise "normal".
- CRITICAL: If there are MULTIPLE items billed in the invoice, you MUST create MULTIPLE objects inside the "items" array. Do not combine them into one item.

Expected JSON Structure:
{
  "clientName": "string",
  "clientAddress": "string",
  "noPo": "string",
  "site": "string",
  "date": "YYYY-MM-DD",
  "items": [{"name":"string","qty":1,"price":0,"tb":"string","bg":"string","desc":"string"}],
  "notes": "string",
  "type": "string"
}

INVOICE TEXT:
${truncatedText}`;

    // Call Gemini with retry using the delay suggested by the API
    let result;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        result = await model.generateContent(prompt);
        break;
      } catch (err) {
        const details = Array.isArray(err?.errorDetails) ? err.errorDetails : [];

        // Extract retryDelay from Google's RetryInfo (usually 60s)
        const retryInfo = details.find(d => d['@type']?.includes('RetryInfo'));
        let retryDelayStr = retryInfo?.retryDelay || '60s';
        let retryDelayMs = (parseInt(retryDelayStr) || 60) * 1000;

        // OPTIMIZATION: If it's a 503 Overload, 60s is too long for UI. Retry in 2s aggressively.
        if (err?.status === 503) {
           retryDelayMs = 2000;
           retryDelayStr = '2s';
        }

        console.error(`Attempt ${attempt} failed [${err?.status}], Gemini suggests waiting ${retryDelayStr}`);

        if ((err?.status === 429 || err?.status === 503) && attempt < 2) {
          console.log(`Waiting ${retryDelayMs / 1000}s before retrying...`);
          await new Promise(r => setTimeout(r, retryDelayMs));
        } else {
          return NextResponse.json({
            error: `Rate limited. Coba lagi dalam ${retryDelayStr}.`,
            retryAfter: retryDelayStr
          }, {
            status: 429,
            headers: { 'Access-Control-Allow-Origin': '*' }
          });
        }
      }
    }
    const response = await result.response;
    let text = response.text();
    
    // Clean up response (sometimes Gemini adds ```json ... ```)
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
      const extractedData = JSON.parse(text);
      console.log("Extracted Data:", JSON.stringify(extractedData, null, 2));
      return NextResponse.json({ success: true, data: extractedData }, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    } catch (parseError) {
      console.error("Gemini JSON Parse Error:", text);
      return NextResponse.json({ 
        error: 'AI returned invalid JSON format', 
        raw: text 
      }, { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

  } catch (error) {
    console.error('Scan PDF Error:', error);
    return NextResponse.json({ error: error.message }, { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}

