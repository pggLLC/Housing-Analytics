const nodemailer = require('nodemailer');
const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');

const urlToMonitor = 'https://example.com'; // Change to your target website

// Email configuration for notifications
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'your-email@gmail.com', // Your email
        pass: 'your-email-password' // Your email password
    }
});

async function checkWebsite() {
    try {
        const response = await fetch(urlToMonitor);
        const body = await response.text();
        const dom = new JSDOM(body);
        const links = [...dom.window.document.querySelectorAll('a')].map(link => link.href);

        // Link checking
        links.forEach(link => {
            fetch(link)
                .then(res => {
                    if (!res.ok) {
                        throw new Error(`Link ${link} returned ${res.status}`);
                    }
                })
                .catch(err => sendEmailNotification(err.message));
        });

        // Placeholder for change detection logic
        // e.g., Save current page hash/checksum and compare for changes.

    } catch (error) {
        console.error('Error checking website:', error);
        sendEmailNotification(error.message);
    }
}

function sendEmailNotification(message) {
    const mailOptions = {
        from: 'your-email@gmail.com',
        to: 'recipient-email@test.com', // Email to receive notifications
        subject: 'Website Monitoring Alert',
        text: message,
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return console.log('Error sending email:', error);
        }
        console.log('Email sent: ' + info.response);
    });
}

setInterval(checkWebsite, 60 * 1000); // Check the website every minute