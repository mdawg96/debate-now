import React from 'react';
import { useNavigate } from 'react-router-dom';
import './Privacy.css';

function Privacy() {
    const navigate = useNavigate();

    return (
        <div className="privacy-container">
            <button className="back-button" onClick={() => navigate('/')}>Back to Home</button>
            <div className="privacy-content">
                <h1>Privacy Policy</h1>
                <p className="last-updated">Last Updated: {new Date().toLocaleDateString()}</p>

                <section>
                    <h2>1. Information We Collect</h2>
                    <p>We collect the following types of information:</p>
                    <ul>
                        <li>Account information (email, username)</li>
                        <li>Debate performance statistics</li>
                        <li>Audio and video during debates (not stored)</li>
                        <li>Chat messages during debates</li>
                        <li>Usage data and analytics</li>
                    </ul>
                </section>

                <section>
                    <h2>2. How We Use Your Information</h2>
                    <p>We use your information to:</p>
                    <ul>
                        <li>Provide and improve our services</li>
                        <li>Match you with debate partners</li>
                        <li>Maintain leaderboards and statistics</li>
                        <li>Ensure compliance with our terms of service</li>
                        <li>Protect against abuse and violations</li>
                    </ul>
                </section>

                <section>
                    <h2>3. Data Storage and Security</h2>
                    <p>Your data is stored securely using Firebase services. We implement appropriate security measures to protect your information.</p>
                    <p>Important notes about data storage:</p>
                    <ul>
                        <li>Audio and video streams are not recorded or stored</li>
                        <li>Chat messages are stored only for the duration of the debate</li>
                        <li>User statistics are stored indefinitely for leaderboard purposes</li>
                    </ul>
                </section>

                <section>
                    <h2>4. Data Sharing</h2>
                    <p>We do not sell your personal information. Your information may be shared:</p>
                    <ul>
                        <li>With other users (limited to username and debate statistics)</li>
                        <li>With service providers (Firebase, WebRTC)</li>
                        <li>When required by law</li>
                    </ul>
                </section>

                <section>
                    <h2>5. Your Rights</h2>
                    <p>You have the right to:</p>
                    <ul>
                        <li>Access your personal information</li>
                        <li>Request correction of inaccurate data</li>
                        <li>Request deletion of your account</li>
                        <li>Opt-out of certain data collection</li>
                    </ul>
                </section>

                <section>
                    <h2>6. Children's Privacy</h2>
                    <p>Our service is not intended for users under 13 years of age. We do not knowingly collect information from children under 13.</p>
                </section>

                <section>
                    <h2>7. Changes to Privacy Policy</h2>
                    <p>We may update this privacy policy from time to time. We will notify you of any changes by posting the new policy on this page.</p>
                </section>

                <section>
                    <h2>8. Contact Us</h2>
                    <p>If you have questions about this Privacy Policy, please contact us at [Your Contact Information].</p>
                </section>
            </div>
        </div>
    );
}

export default Privacy; 