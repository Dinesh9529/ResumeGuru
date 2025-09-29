require("dotenv").config();
const express = require("express");
const crypto  = require("crypto");
const axios   = require("axios");

const app = express();
app.use(express.json());

// Load PhonePe env vars
const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID;
const SALT_KEY    = process.env.PHONEPE_SALT_KEY;
const BASE_URL    = process.env.PHONEPE_BASE_URL;
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());
// Increased limit to handle larger resumes if needed
app.use(express.json({ limit: "5mb" }));

// --- CONFIGURATION ---
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Using a capable model. You can experiment with others.
const MODEL = "openai/gpt-4o"; // Switched to a more powerful model for higher quality reviews.

// --- CORE FUNCTIONS ---

/**
 * Calculates a basic ATS-like score. This is a simple estimation
 * and not a replacement for real ATS systems.
 * @param {string} resume - The user's resume text.
 * @param {string} jd - The job description text.
 * @returns {number} - A score between 0 and 100.
 */
function calculateATSMatchScore(resume, jd) {
  let score = 20; // Start with a base score
  const resumeLower = resume.toLowerCase();

  // 1. Word Count Score (20 points)
  const wordCount = (resume.match(/\b\w+\b/g) || []).length;
  if (wordCount < 250) {
    score += 5;
  } else if (wordCount <= 700) {
    score += 20;
  } else {
    score += 10;
  }

  // 2. Section Score (25 points)
  if (resumeLower.includes("experience")) score += 10;
  if (resumeLower.includes("education")) score += 5;
  if (resumeLower.includes("skill")) score += 10; // "skill" catches "skills" too

  // 3. Action Verb Score (15 points)
  const actionVerbs = ["managed", "led", "developed", "created", "implemented", "achieved", "increased", "reduced", "negotiated", "launched"];
  const actionVerbCount = actionVerbs.filter(verb => resumeLower.includes(verb)).length;
  score += Math.min(actionVerbCount, 10) * 1.5;

  // 4. Job Description Keyword Matching (20 points)
  if (jd) {
    const jdLower = jd.toLowerCase();
    const keywords = [...new Set(jdLower.match(/\b[a-z]{4,}\b/g) || [])].slice(0, 25);
    if (keywords.length > 0) {
        const hits = keywords.filter(k => resumeLower.includes(k)).length;
        score += Math.round((hits / keywords.length) * 20);
    }
  } else {
    score += 10; // Add default points if no JD
  }

  return Math.min(100, Math.round(score));
}

/**
 * Cleans the raw response from the AI, removing separators but preserving markdown.
 * @param {string} text - The raw AI response.
 * @returns {string} - The cleaned response.
 */
function cleanAIResponse(text) {
  // Removes the '---' separators and trims whitespace, keeping useful markdown.
  return text.replace(/---/g, "").trim();
}

/**
 * Builds the detailed prompt for the AI with strict instructions.
 * This is the most critical part for getting a high-quality review.
 * @param {string} resume - The user's resume text.
 * @param {string} jd - The job description text.
 * @returns {{systemPrompt: string, userContent: string}} - An object with system and user prompts.
 */
function buildImprovedPrompt(resume, jd) {
  const systemPrompt = `You are "Resume Guru," an expert senior recruiter and friendly career coach from India. Your goal is to provide supportive, honest, and highly actionable feedback in simple, clear English.

**Your Guiding Principles:**
1.  **Be Human and Supportive:** Use an encouraging and empathetic tone. For example, instead of "Your resume is bad," say "Here are a few ways we can make your resume even stronger."
2.  **Be Honest and Specific:** Provide concrete, actionable advice. Explain *how* and *why* to make changes.
3.  **THE MOST IMPORTANT RULE: NEVER INVENT INFORMATION.** Do not invent metrics, numbers, percentages, or project details. If the user's resume lacks specifics, you MUST point it out and provide a template with placeholders like "[Number]%", "[Specific Metric]", or "[X number]" for the user to fill in. This is critical for providing ethical and useful advice.
4.  **Use Simple Markdown:** Use **bold** for headings (e.g., "**SUMMARY**") and lists for clarity. Do not use HTML tags.

**Review Structure:**
Provide your feedback in the exact following structure. Do not add or remove sections.

---

**SUMMARY**
(Write a concise, 2-3 sentence professional summary based on the resume. This should be a high-level overview of the candidate's profile.)

---

**STRENGTHS**
(List 3-4 key strengths. Focus on things like strong experience, good career progression, or valuable skills.)
1.
2.
3.

---

**AREAS FOR IMPROVEMENT**
(List 3-4 major areas for improvement. Be specific. Instead of "Vague descriptions," say "Your job descriptions could be more impactful. For example, instead of 'handled tasks,' describe what those tasks achieved.")
1.
2.
3.

---

**REWRITTEN BULLET POINTS (Examples)**
(Rewrite 2-3 of the user's weakest bullet points into the STAR format (Situation, Task, Action, Result). **CRITICAL REMINDER:** Do not invent metrics. Use placeholders and explain that the user needs to fill them in with their real achievements.)

* **Original:** "SOFTWARE SUPPORT & EMPLIMANTATION and Business Devlopment"
* **Rewritten Example:** "Drove business development and software implementation for over [Number] clients by [describe a specific action you took], leading to a [mention a specific, quantifiable outcome, e.g., 15% growth in the client base or a 20% faster implementation cycle]."

1.  *(Your rewritten bullet point 1 for the user's resume)*
2.  *(Your rewritten bullet point 2 for the user's resume)*
3.  *(Your rewritten bullet point 3 for the user's resume)*

---

**KEYWORDS ANALYSIS (from Job Description)**
(If a job description is provided, compare it to the resume. If not, state "No job description was provided, so I've focused on general improvements.")
* **Keywords Present:** (List keywords from the JD found in the resume)
* **Keywords Missing:** (List important keywords from the JD that are missing from the resume and suggest where they could be added)

---

**FINAL ACTION PLAN**
(Provide a clear, prioritized list of 3 final steps the user should take.)
1.  **Top Priority:** (e.g., "Quantify your achievements. Go through each role and add numbers to show the impact you made.")
2.  **Next Step:** (e.g., "Create a dedicated 'Technical Skills' section to highlight your software expertise.")
3.  **Final Polish:** (e.g., "Proofread carefully to fix spelling and grammar errors. For instance, 'Exeperience' should be 'Experience'.")`;

  const userContent = `Please review the following resume${jd ? " against the provided job description" : ""}.

**Resume:**
\`\`\`
${resume}
\`\`\`

${jd ? `**Job Description:**\n\`\`\`\n${jd}\n\`\`\`` : ""}`;

  return { systemPrompt, userContent };
}

/**
 * Calls the OpenRouter AI API with the constructed prompt.
 * @param {string} systemPrompt - The instructions for the AI's persona and rules.
 * @param {string} userContent - The user's resume and JD.
 * @returns {Promise<string>} - The AI's response text.
 */
async function callAI(systemPrompt, userContent) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ultr-resume-guru.replit.app", // Replace with your actual app URL
        "X-Title": "Ultra Resume Guru" // Replace with your app's title
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
        console.error("? AI API Error Response:", errorData);
        throw new Error(`AI API request failed with status ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();

    if (!content || content.length < 50) {
      throw new Error("AI response was empty or too short.");
    }

    return content;
  } catch (error) {
    console.error("? AI call failed:", error);
    // Return a user-friendly error message
    return "I'm sorry, but I encountered an error while reviewing the resume. Please try again in a moment.";
  }
}

// --- API ROUTES ---

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

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Ultra Resume Guru API is healthy and running." });
});

// --- SERVER START ---
app.post("/cashfree-webhook", (req, res) => {
  console.log("Cashfree webhook payload:", req.body);
  res.sendStatus(200);
});

// Check for API key on startup for fail-fast behavior
if (!process.env.OPENROUTER_API_KEY) {
    console.warn("?? WARNING: OPENROUTER_API_KEY is not set. The API will not work.");
}

// 👇 इस route को app.listen से ऊपर डालो
// 👇 इस पूरे कोड ब्लॉक से अपने पुराने /create-order वाले को बदलें
app.post("/create-order", async (req, res) => {
  const { amount } = req.body;

  // Debugging logs to confirm variables are loaded
  console.log("Using App ID:", process.env.CASHFREE_APP_ID ? "Loaded" : "Missing");
  console.log("Using Secret Key:", process.env.CASHFREE_SECRET_KEY ? "Loaded" : "Missing");

  try {
    const response = await axios.post(
      // ❗️ MISTAKE FIXED: Use the SANDBOX URL for testing
      "https://sandbox.cashfree.com/pg/orders",
      {
        order_amount: amount,
        order_currency: "INR",
        order_id: "order_" + Date.now(),
        customer_details: {
          customer_id: "cust_" + Date.now(),
          customer_email: "test@example.com",
          customer_phone: "9999999999"
        },
        order_meta: {
          // It's good practice to set a return URL
          return_url: "https://YOUR_WEBSITE_URL/order_status?order_id={order_id}"
        }
      },
      {
        headers: {
        "x-client-id": process.env.CASHFREE_APP_ID?.trim(),
        "x-client-secret": process.env.CASHFREE_SECRET_KEY?.trim(),
        "x-api-version": "2022-09-01",
        "Content-Type": "application/json"
    }
      }
    );

    res.json({ payment_session_id: response.data.payment_session_id });
  } catch (err) {
    // Improved error logging
    console.error("Cashfree API Error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || "Failed to create order." });
  }
});

app.post("/api/create-order", async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    const payload = {
      merchantId: MERCHANT_ID,
      merchantTransactionId: orderId,
      amount: amount * 100, // paise में
      redirectUrl: "https://resumeguru.onrender.com/payment-status",
      redirectMode: "POST",
      callbackUrl: "https://resumeguru.onrender.com/webhook/phonepe",
      paymentInstrument: { type: "PAY_PAGE" }
    };

    const payloadString = JSON.stringify(payload);
    const base64Payload = Buffer.from(payloadString).toString("base64");

    const endpoint = "/pg/v1/pay";
    const xVerify = crypto
      .createHash("sha256")
      .update(base64Payload + endpoint + SALT_KEY)
      .digest("hex") + "###" + 1;

    const response = await axios.post(
      `${BASE_URL}${endpoint}`,
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

app.post("/webhook/phonepe", (req, res) => {
  try {
    console.log("Webhook received:", req.body);

    // अगर status SUCCESS है तो unlock logic चलाओ
    if (req.body?.code === "PAYMENT_SUCCESS" || req.body?.success) {
      console.log("✅ Payment Success → Unlock ResumeGuru Ultra");
      // TODO: यहाँ अपना unlock code डालो
    } else {
      console.log("❌ Payment Failed/Cancelled");
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).send("FAIL");
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`? Ultra Resume Guru API is running on port ${PORT}`);
});









