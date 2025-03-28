import React from 'react';
import { useNavigate } from 'react-router-dom';
import './Terms.css';

function Terms() {
    const navigate = useNavigate();

    return (
        <div className="terms-container">
            <button className="back-button" onClick={() => navigate('/')}>Back to Home</button>
            <div className="terms-content">
                <h1>Terms of Service</h1>
                <p className="last-updated">Last Updated: {new Date().toLocaleDateString()}</p>

                <section>
                    <h2>1. Acceptance of Terms</h2>
                    <p>By accessing and using DebateNow, you agree to be bound by these Terms of Service and all applicable laws and regulations.</p>
                </section>

                <section>
                    <h2>2. Age Restrictions</h2>
                    <p>You must be at least 13 years old to use this service. If you are under 18, you must have parental consent to use this service.</p>
                </section>

                <section>
                    <h2>3. User Conduct</h2>
                    <p>You agree to:</p>
                    <ul>
                        <li>Not engage in hate speech or harassment</li>
                        <li>Not impersonate others</li>
                        <li>Not use the service for any illegal purposes</li>
                        <li>Not share inappropriate or harmful content</li>
                        <li>Not attempt to manipulate or abuse the service</li>
                    </ul>
                </section>

                <section>
                    <h2>4. Content Guidelines</h2>
                    <p>Users are responsible for all content they create or share. Content must not:</p>
                    <ul>
                        <li>Violate any laws or regulations</li>
                        <li>Infringe on intellectual property rights</li>
                        <li>Contain hate speech or discriminatory content</li>
                        <li>Include personal or private information of others</li>
                    </ul>
                </section>

                <section>
                    <h2>5. Account Termination</h2>
                    <p>We reserve the right to terminate or suspend accounts that violate these terms or for any other reason at our discretion.</p>
                </section>

                <section>
                    <h2>6. Disclaimer of Warranties</h2>
                    <p>The service is provided "as is" without any warranties, express or implied. We do not guarantee uninterrupted or error-free service.</p>
                </section>

                <section>
                    <h2>7. Limitation of Liability</h2>
                    <p>We shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the service.</p>
                </section>

                <section>
                    <h2>8. Changes to Terms</h2>
                    <p>We reserve the right to modify these terms at any time. Continued use of the service after changes constitutes acceptance of the new terms.</p>
                </section>

                <section>
                    <h2>9. Contact Information</h2>
                    <p>For any questions about these terms, please contact us at [Your Contact Information].</p>
                </section>
            </div>
        </div>
    );
}

export default Terms; 