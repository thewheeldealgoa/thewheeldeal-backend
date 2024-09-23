const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const twilio = require('twilio');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(helmet());
app.use(bodyParser.json());

// CORS Configuration: Restricting to your domain
const corsOptions = {
  origin: ['https://thewheeldeal.in', 'http://localhost:3000'],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// OAuth2 setup for Nodemailer
const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

async function sendEmail(to, subject, text) {
  try {
    const accessTokenResponse = await oAuth2Client.getAccessToken();
    const accessToken = accessTokenResponse?.token;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.EMAIL,
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        refreshToken: process.env.REFRESH_TOKEN,
        accessToken: accessToken,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL,
      to: to,
      subject: subject,
      text: text,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent: ', result);
    return result;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

// Twilio client setup
const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// OTP Expiry and Rate Limiting
const otpStore = {};
const OTP_EXPIRY_TIME = 10 * 60 * 1000; // 10 minutes

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 OTP requests per windowMs
});

// Helper function to format Indian phone numbers
const formatPhoneNumber = (number) => {
  if (!number || number.length !== 10) {
    console.error('Invalid phone number format.');
    return null;
  }
  return `+91${number.replace(/\D/g, '')}`;
};

// Route for handling OTP generation and sending via Twilio
app.post('/api/submit', otpLimiter, async (req, res) => {
  const { mobileNo, formData } = req.body;
  const formattedMobileNo = formatPhoneNumber(mobileNo);
  if (!formattedMobileNo) {
    return res.status(400).json({ message: 'Invalid phone number format.' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000); // Generate a 6-digit OTP

  try {
    // Send OTP via Twilio
    await twilioClient.messages.create({
      body: `Your OTP is: ${otp}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedMobileNo,
    });

    otpStore[formattedMobileNo] = { otp, formData };

    // Set OTP to expire after 10 minutes
    setTimeout(() => {
      delete otpStore[formattedMobileNo];
      console.log(`OTP expired for ${formattedMobileNo}`);
    }, OTP_EXPIRY_TIME);

    res.status(200).json({ message: 'OTP sent successfully!' });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ message: 'Failed to send OTP.' });
  }
});

// Route for OTP verification
app.post('/api/verify', (req, res) => {
  const { mobileNo, otp } = req.body;
  const formattedMobileNo = formatPhoneNumber(mobileNo);

  if (otpStore[formattedMobileNo] && otpStore[formattedMobileNo].otp === parseInt(otp)) {
    // OTP matches, process the form data
    const formData = otpStore[formattedMobileNo].formData;

    // Send booking confirmation email to admin
    const emailText = `New booking request:\n\nName: ${formData.name}\nMobile No: ${formData.mobileNo}\nCar Required Date: ${formData.carRequiredDate}`;
    sendEmail('discordant2020@gmail.com', 'New Car Booking Request', emailText)
      .then(() => {
        delete otpStore[formattedMobileNo]; // Clear OTP after successful verification
        res.status(200).json({ message: 'OTP verified successfully! Booking request sent.' });
      })
      .catch(error => {
        res.status(500).json({ message: 'Failed to send booking confirmation email.' });
      });
  } else {
    res.status(400).json({ message: 'Invalid OTP or OTP expired.' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
