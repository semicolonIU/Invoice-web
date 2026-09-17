import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { extractText } from 'unpdf';

// Force Node.js runtime (required for file buffers)
export const runtime = 'nodejs';

// Max timeout so serverless functions don't hang forever
export const maxDuration = 30;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400, headers: CORS_HEADERS });
    }

    // ── 1. Read PDF buffer & convert to Base64 ─────────────────────────────
    const buffer = await file.arrayBuffer();
    const base64Data = Buffer.from(buffer).toString('base64');

    // ── 2. Build prompt ───────────────────────────────────────────────────
    const prompt = `You are an expert invoice data extractor. Read the attached PDF invoice document (both text and layout) and extract the invoice fields into ONLY a valid JSON object — no markdown, no explanation.

Rules:
- clientName: the client/buyer company name. NEVER use "PUTRA BANUA MANDIRI" (that is the vendor).
- clientAddress: use address labelled "ALAMAT PENGIRIMAN BARANG" if present.
- price: integer (strip Rp and dots/commas).
- tb: Tugboat name (e.g. TB KSA-01). bg: Barge name. desc: extra description.
- type: "rental" if sewa/rental is mentioned, else "normal".
- items: one object per line item — do NOT merge multiple items into one.

JSON schema:
{"clientName":"","clientAddress":"","noPo":"","site":"","date":"YYYY-MM-DD","type":"normal","items":[{"name":"","qty":1,"price":0,"tb":"","bg":"","desc":""}]}`;

    // ── 3. Call Gemini AI Multimodal ─────────────────────────────────────
    const apiKey = process.env.GOOGLE_API_KEY || 'AIzaSyDIwa7qO-bASLVwOYoub-XJXQEm4AeCPgE';
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.5-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: 1024,
      },
    });

    let result;
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await model.generateContent([
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: base64Data,
            },
          },
          prompt,
        ]);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const status = err?.status;
        console.error(`Attempt ${attempt}/3 failed [${status}]: ${err?.message || err}`);

        if (attempt < 3) {
          const wait = status === 429 ? 1000 : 500;
          await new Promise(r => setTimeout(r, wait));
        }
      }
    }

    if (lastErr) {
      const status = lastErr?.status;
      if (status === 429) {
        return NextResponse.json(
          { error: 'Gemini AI terlalu banyak permintaan. Tunggu 10 detik lalu coba lagi.' },
          { status: 429, headers: CORS_HEADERS }
        );
      }
      throw lastErr;
    }

    // ── 4. Parse response ─────────────────────────────────────────────────
    const responseText = result.response.text()
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    let extractedData;
    try {
      extractedData = JSON.parse(responseText);
    } catch {
      console.error('JSON parse fail:', responseText);
      return NextResponse.json(
        { error: 'AI mengembalikan format yang tidak valid. Coba lagi.' },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    console.log('Extracted:', JSON.stringify(extractedData));
    return NextResponse.json({ success: true, data: extractedData }, { headers: CORS_HEADERS });

  } catch (error) {
    console.error('Scan PDF Error:', error);
    return NextResponse.json(
      { error: `Terjadi kesalahan: ${error.message}` },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
