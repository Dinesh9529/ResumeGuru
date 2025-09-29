// --- DEPENDENCIES ---
require("dotenv").config();
const express = require("express");
const crypto  = require("crypto");
const axios   = require("axios");
const cors    = require("cors");
const fetch   = require("node-fetch"); // ensure installed

// 👇 Pehle app initialize karo
const app = express();

// 👇 Ab CORS config lagao
const corsOptions = {
  origin: "*",   // testing ke liye sab origins allow
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};
app.use(cors(corsOptions));

// 👇 JSON body parser
app.use(express.json({ limit: "5mb" }));

// --- PHONEPE ENV VARS ---
const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID;
const SALT_KEY    = process.env.PHONEPE_SALT_KEY;
const BASE_URL    = process.env.PHONEPE_BASE_URL;

// --- OPENROUTER CONFIG ---
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openai/gpt-4o"; // GPT‑4o model for resume review

// --- ATS SCORE FUNCTION ---
function calculateATSMatchScore(resume, jd) {
  let score = 20;
  const resumeLower = resume.toLowerCase();

  // Word Count
  const wordCount = (resume.match(/\b\w+\b/g) || []).length;
  if (wordCount < 250) score += 5;
  else if (wordCount <= 700) score += 20;
  else score += 10;

  // Sections
  if (resumeLower.includes("experience")) score += 10;
  if (resumeLower.includes("education")) score += 5;
  if (resumeLower.includes("skill")) score += 10;

  // Action Verbs
  const actionVerbs = ["managed","led","developed","created","implemented","achieved","increased","reduced","negotiated","launched"];
  const actionVerbCount = actionVerbs.filter(v => resumeLower.includes(v)).length;
  score += Math.min(actionVerbCount, 10) * 1.5;

  // JD Keywords
  if (jd) {
    const jdLower = jd.toLowerCase();
    const keywords = [...new Set(jdLower.match(/\b[a-z]{4,}\b/g) || [])].slice(0, 25);
    if (keywords.length > 0) {
      const hits = keywords.filter(k => resumeLower.includes(k)).length;
      score += Math.round((hits / keywords.length) * 20);
    }
  } else {
    score += 10;
  }

  return Math.min(100, Math.round(score));
}

// --- CLEAN RESPONSE ---
function cleanAIResponse(text) {
  return text.replace(/---/g, "").trim();
}

// --- PROMPT BUILDER ---
function buildImprovedPrompt(resume, jd) {
  const systemPrompt = `You are "Resume Guru," an expert senior recruiter and friendly career coach from India. Your goal is to provide supportive, honest, and highly actionable feedback in simple, clear English.`;

  const userContent = `Please review the following resume${jd ? " against the provided job description" : ""}.

**Resume:**
\`\`\`
${resume}
\`\`\`

${jd ? `**Job Description:**\n\`\`\`\n${jd}\n\`\`\`` : ""}`;

  return { systemPrompt, userContent };
}

// --- CALL OPENROUTER ---
async function callAI(systemPrompt, userContent) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://resumeguru.onrender.com",
        "X-Title": "Ultra Resume Guru"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        temperature: 0.5,
        max_tokens: 3000,
        top_p: 0.9,
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("❌ AI API Error Response:", errorData);
      throw new Error(`AI API request failed with status ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content || content.length < 50) throw new Error("AI response was empty or too short.");
    return content;
  } catch (error) {
    console.error("❌ AI call failed:", error);
    return "I'm sorry, but I encountered an error while reviewing the resume. Please try again in a moment.";
  }
}

// --- ROUTES ---

// Resume Review
app.post("/api/review", async (req, res) => {
  try {
    const { resume, jd } = req.body || {};
    if (!resume || resume.trim().length < 50) {
      return res.status(400).json({ ok: false, error: "Resume is missing or too short." });
    }

    const atsScore = calculateATSMatchScore(resume, jd || "");
    const { systemPrompt, userContent } = buildImprovedPrompt(resume, jd || "");
    const aiReviewRaw = await callAI(systemPrompt, userContent);
    const aiReview = cleanAIResponse(aiReviewRaw);

    res.json({ ok: true, atsScore, aiReview });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "An internal server error occurred." });
  }
});

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Ultra Resume Guru API is healthy and running." });
});

// PhonePe Order Create
app.post("/api/create-order", async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    // 👇 Agar frontend se orderId na aaye to backend khud generate kare
    const txnId = orderId || "RGU_" + Date.now();

    const payload = {
      merchantId: MERCHANT_ID,
      merchantTransactionId: txnId,   // 👈 hamesha unique hona chahiye
      amount: amount * 100,
      redirectUrl: "https://resumeguru.onrender.com/payment-status",
      redirectMode: "POST",
      callbackUrl: "https://resumeguru.onrender.com/webhook/phonepe",
      paymentInstrument: { type: "PAY_PAGE" }
    };

    const payloadString = JSON.stringify(payload);
    const base64Payload = Buffer.from(payloadString).toString("base64");

   const endpoint = "/pg/v1/pay";
const url = `${BASE_URL}${endpoint}`; 
// BASE_URL = "https://api.phonepe.com/apis/hermes"

const xVerify = crypto
  .createHash("sha256")
  .update(base64Payload + endpoint + SALT_KEY)
  .digest("hex") + "###" + 1;

const response = await axios.post(
  url,
  { request: base64Payload },
  {
    headers: {
      "Content-Type": "application/json",
      "X-VERIFY": xVerify,
      "X-MERCHANT-ID": MERCHANT_ID
    }
  }
);

    res.json(response.data);
  } catch (err) {
    console.error("PhonePe order error:", err.response?.data || err.message);
    res.status(500).json({ error: "Order create failed" });
  }
});
// PhonePe Webhook
app.post("/webhook/phonepe", (req, res) => {
  try {
    console.log("Webhook received:", req.body);

    if (req.body?.code === "PAYMENT_SUCCESS" || req.body?.success) {
      console.log("✅ Payment Success → Unlock ResumeGuru Ultra");
      // TODO: unlock logic
    } else {
      console.log("❌ Payment Failed/Cancelled");
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).send("FAIL");
  }
});

// --- SERVER START ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Ultra Resume Guru API is running on port ${PORT}`);
});





