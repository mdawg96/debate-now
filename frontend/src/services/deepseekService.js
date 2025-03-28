import OpenAI from "openai";

// Set the actual DeepSeek API key
const DEEPSEEK_API_KEY = "sk-0eccf497762b472281c9eb18e500b7c3";

/**
 * Creates a DeepSeek API service for debate evaluation
 * @returns {Object} Service methods
 */
export const createDeepseekService = () => {
    // Initialize OpenAI client with DeepSeek's API endpoint
    const openai = new OpenAI({
        baseURL: 'https://api.deepseek.com',
        apiKey: DEEPSEEK_API_KEY,
        dangerouslyAllowBrowser: true  // Allow browser usage
    });
    
    /**
     * Evaluate a debate based on transcripts
     * @param {Object} params - Evaluation parameters
     * @param {string} params.localTranscript - Transcript of the local participant
     * @param {string} params.remoteTranscript - Transcript of the remote participant
     * @param {string} params.localCharacter - Character of local participant (e.g., "Trump", "Kamala")
     * @param {string} params.remoteCharacter - Character of remote participant
     * @param {string} params.evaluationCriteria - Optional criteria for evaluation
     * @returns {Promise<Object>} The evaluation result
     */
    const evaluateDebate = async ({ 
        localTranscript, 
        remoteTranscript, 
        localCharacter, 
        remoteCharacter,
        evaluationCriteria = "" 
    }) => {
        try {
            console.log("Evaluating debate with transcripts:", {
                localLength: localTranscript?.length || 0,
                remoteLength: remoteTranscript?.length || 0,
                localCharacter,
                remoteCharacter
            });
            
            // Create a system prompt that includes evaluation guidelines
            const systemPrompt = `You are an expert debate judge evaluating a debate between ${localCharacter} and ${remoteCharacter}.
            
${evaluationCriteria || `Please evaluate this debate based on:
1. Strength of arguments
2. Quality of evidence
3. Clarity of presentation
4. Response to opposing arguments
5. Overall persuasiveness`}

Provide a fair, detailed analysis with specific examples from the debate.
Choose a winner and explain your reasoning clearly. Format your response with these sections:
- Summary of the debate
- Strengths and weaknesses of each debater
- Final decision with reasoning`;

            // Handle empty transcripts case
            const processedLocalTranscript = localTranscript?.trim() || "(No transcript available)";
            const processedRemoteTranscript = remoteTranscript?.trim() || "(No transcript available)";

            // Send request to DeepSeek API
            const completion = await openai.chat.completions.create({
                model: "deepseek-chat", // Using the cheapest model
                messages: [
                    { role: "system", content: systemPrompt },
                    { 
                        role: "user", 
                        content: `Here is the transcript of the debate:

${localCharacter}'s arguments:
${processedLocalTranscript}

${remoteCharacter}'s arguments:
${processedRemoteTranscript}

Please evaluate this debate and determine a winner.`
                    }
                ],
                temperature: 0.7,
                max_tokens: 2000,
            });
            
            return {
                success: true,
                evaluation: completion.choices[0].message.content,
                usage: completion.usage,
            };
        } catch (error) {
            console.error("Error evaluating debate:", error);
            return {
                success: false,
                error: error.message,
            };
        }
    };
    
    // Return public methods
    return {
        evaluateDebate
    };
}; 