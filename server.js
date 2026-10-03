require("dotenv").config();

const express = require("express");
const multer = require("multer");
const { Resend } = require("resend");

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);
const CONTACT_EMAIL = process.env.CONTACT_EMAIL;
const PORT = process.env.PORT || 3000;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/webp",
];

// Parses multipart/form-data; the optional file field is named "file"
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

function validate(name, email, message) {
  const errors = {};

  if (!name || name.trim().length < 2) {
    errors.name = "Name is required.";
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "A valid email is required.";
  }
  if (!message || message.trim().length < 10) {
    errors.message = "Message must be at least 10 characters.";
  }

  return errors;
}

// Prevents HTML injection in the email body
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Wrap multer so its errors (e.g. file too large) become JSON responses
function handleUpload(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "File is too large. Maximum file size is 10 MB.",
      });
    }

    console.error("Upload error:", err);
    return res.status(400).json({ error: "Invalid form submission." });
  });
}

app.post("/api/contact", handleUpload, async (req, res) => {
  try {
    const name = String(req.body.name || "");
    const company = String(req.body.company || "");
    const email = String(req.body.email || "");
    const message = String(req.body.message || "");
    const file = req.file; // undefined if no file was sent

    const errors = validate(name, email, message);
    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        error: "Validation failed.",
        fields: errors,
      });
    }

    if (!process.env.RESEND_API_KEY || !CONTACT_EMAIL) {
      console.error(
        "Missing RESEND_API_KEY or CONTACT_EMAIL environment variables."
      );
      return res.status(500).json({
        error: "Server is not configured to send emails.",
      });
    }

    // Optional attachment
    let attachments;
    const hasFile = file && file.size > 0;

    if (hasFile) {
      if (!ALLOWED_TYPES.includes(file.mimetype)) {
        return res.status(400).json({
          error:
            "Invalid file type. Please upload a PDF, Word, Excel, JPG, PNG, or WebP file.",
        });
      }

      attachments = [
        {
          filename: file.originalname,
          content: file.buffer,
        },
      ];
    }

    const result = await resend.emails.send({
      from: "Website Contact Form <onboarding@resend.dev>",
      to: CONTACT_EMAIL,
      replyTo: email,
      subject: `New contact form submission from ${name}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
          <h2>New contact form submission</h2>
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          ${
            company
              ? `<p><strong>Company:</strong> ${escapeHtml(company)}</p>`
              : ""
          }
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          <hr />
          <p><strong>Message:</strong></p>
          <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
          ${
            hasFile
              ? `<p><strong>Attachment:</strong> ${escapeHtml(
                  file.originalname
                )}</p>`
              : ""
          }
        </div>
      `,
      ...(attachments ? { attachments } : {}),
    });

    if (result.error) {
      console.error("Resend API error:", result.error);
      return res.status(502).json({ error: "Failed to deliver email." });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Failed to send email:", error);
    return res.status(502).json({ error: "Failed to deliver email." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});