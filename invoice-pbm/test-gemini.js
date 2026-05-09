const { GoogleGenerativeAI } = require('@google/generative-ai');

async function test() {
  console.log("Using API Key:", process.env.GOOGLE_API_KEY ? process.env.GOOGLE_API_KEY.substring(0, 10) + "..." : "NOT SET");
  
  try {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
    
    console.log("Sending ping to Gemini...");
    const result = await model.generateContent("Hello, respond with 'ping'");
    console.log("SUCCESS! Response:", result.response.text());
  } catch (error) {
    console.error("ERROR:");
    console.error(JSON.stringify(error, null, 2));
    if (error.errorDetails) {
        console.error("Details:", JSON.stringify(error.errorDetails, null, 2));
    }
  }
}

test();
