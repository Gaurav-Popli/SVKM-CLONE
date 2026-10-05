const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// UNIVERSITY KNOWLEDGE
// ==========================================

const knowledgePath = path.join(
    __dirname,
    'data',
    'knowledge.json'
);

let knowledgeBase = {};

try {
    knowledgeBase = JSON.parse(
        fs.readFileSync(knowledgePath, 'utf8')
    );

    console.log('University knowledge loaded');
} catch (error) {
    console.error(
        'Could not load knowledge.json:',
        error.message
    );
}

// ==========================================
// GEMINI INTERACTIONS API
// ==========================================

const GEMINI_API_URL =
    'https://generativelanguage.googleapis.com/v1beta/interactions';

// ==========================================
// FUNCTION TOOLS
// ==========================================

const tools = [
    {
        type: 'function',
        name: 'get_programs',
        description:
            'Get the programmes offered by a specific school or all schools at SVKM NMIMS Global University.',
        parameters: {
            type: 'object',
            properties: {
                school: {
                    type: 'string',
                    description:
                        'Optional school name. Leave empty to return programmes from all schools.'
                }
            }
        }
    },

    {
        type: 'function',
        name: 'get_admission_contact',
        description:
            'Get the official admission contact numbers for a specific school.',
        parameters: {
            type: 'object',
            properties: {
                school: {
                    type: 'string',
                    description:
                        'School name such as School of Commerce, School of Technology Management and Engineering, or School of Pharmacy & Technology Management.'
                }
            },
            required: ['school']
        }
    },

    {
        type: 'function',
        name: 'get_fee',
        description:
            'Get a verified programme fee from the university knowledge base. Only return fees explicitly present in the knowledge base.',
        parameters: {
            type: 'object',
            properties: {
                programme: {
                    type: 'string',
                    description:
                        'Programme name such as BBA or BCA.'
                }
            },
            required: ['programme']
        }
    },

    {
        type: 'function',
        name: 'get_apply_link',
        description:
            'Get the official online application URL for SVKM NMIMS Global University.',
        parameters: {
            type: 'object',
            properties: {}
        }
    }
];

// ==========================================
// LOCAL FUNCTION EXECUTION
// ==========================================

function executeFunction(name, args) {

    console.log('Function call:', name, args);

    // --------------------------------------
    // PROGRAMMES
    // --------------------------------------

    if (name === 'get_programs') {

        const schoolQuery =
            (args.school || '').toLowerCase().trim();

        let schools = knowledgeBase.schools || [];

        if (schoolQuery) {
            schools = schools.filter(school =>
                school.name
                    .toLowerCase()
                    .includes(schoolQuery)
            );
        }

        return {
            schools: schools.map(school => ({
                name: school.name,
                programs: school.programs
            }))
        };
    }

    // --------------------------------------
    // ADMISSION CONTACT
    // --------------------------------------

    if (name === 'get_admission_contact') {

        const schoolQuery =
            (args.school || '').toLowerCase().trim();

        const school = (knowledgeBase.schools || []).find(
            item =>
                item.name
                    .toLowerCase()
                    .includes(schoolQuery)
        );

        if (!school) {
            return {
                found: false,
                message:
                    'No matching school was found in the university knowledge base.'
            };
        }

        return {
            found: true,
            school: school.name,
            admission_contact: school.admission_contact
        };
    }

    // --------------------------------------
    // FEES
    // --------------------------------------

    if (name === 'get_fee') {

        const programmeQuery =
            (args.programme || '').toLowerCase().trim();

        const verifiedExamples =
            knowledgeBase.fees?.verified_examples || {};

        const matchingProgramme =
            Object.keys(verifiedExamples).find(
                programme =>
                    programme.toLowerCase() ===
                    programmeQuery
            );

        if (!matchingProgramme) {
            return {
                found: false,
                message:
                    'No verified fee for this programme is available in the knowledge base.'
            };
        }

        return {
            found: true,
            programme: matchingProgramme,
            fee: verifiedExamples[matchingProgramme]
        };
    }

    // --------------------------------------
    // APPLY ONLINE
    // --------------------------------------

    if (name === 'get_apply_link') {

        return {
            url:
                knowledgeBase.admissions?.official_apply_url ||
                knowledgeBase.official_links?.apply_online
        };
    }

    return {
        error: `Unknown function: ${name}`
    };
}

// ==========================================
// EXTRACT TEXT
// ==========================================

function extractText(data) {

    let answer = '';

    if (Array.isArray(data.steps)) {

        for (const step of data.steps) {

            if (
                step.type === 'model_output' &&
                Array.isArray(step.content)
            ) {

                for (const item of step.content) {

                    if (
                        item.type === 'text' &&
                        item.text
                    ) {
                        answer += item.text;
                    }
                }
            }
        }
    }

    if (!answer && data.output) {

        if (typeof data.output === 'string') {
            answer = data.output;
        }

        if (Array.isArray(data.output)) {

            for (const item of data.output) {

                if (item.text) {
                    answer += item.text;
                }
            }
        }
    }

    return answer.trim();
}

// ==========================================
// GEMINI REQUEST
// ==========================================

async function geminiRequest(body) {

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error(
            'GEMINI_API_KEY is missing'
        );
    }

    const response = await fetch(
        GEMINI_API_URL,
        {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },

            body: JSON.stringify(body)
        }
    );

    const data = await response.json();

    if (!response.ok) {

        console.error(
            'Gemini error:',
            JSON.stringify(data, null, 2)
        );

        throw new Error(
            data?.error?.message ||
            `Gemini request failed with status ${response.status}`
        );
    }

    return data;
}

// ==========================================
// ASK GEMINI
// ==========================================

async function askGemini(userMessage) {

    const universityContext =
        JSON.stringify(
            knowledgeBase,
            null,
            2
        );

    const instructions = `
You are the AI assistant for SVKM NMIMS Global University, Dhule.

You help prospective students, parents and visitors.

IMPORTANT RULES:

1. Use the university knowledge below as your primary source.

2. Use the available functions whenever they are appropriate.

3. Never invent university-specific information.

4. Never invent:
- fees
- admission deadlines
- eligibility requirements
- scholarships
- programmes
- phone numbers
- addresses
- application procedures

5. If information is not available, clearly tell the user that it must be confirmed with the official university website or admissions office.

6. Keep answers concise and useful.

7. Use bullet points when listing information.

8. If a user asks for programmes, use get_programs.

9. If a user asks for admission contact numbers, use get_admission_contact.

10. If a user asks about fees, use get_fee.

11. If a user asks how to apply or wants the application link, use get_apply_link.

UNIVERSITY KNOWLEDGE:

${universityContext}
`;

    let interaction = await geminiRequest({

        model: 'gemini-3.6-flash',

        system_instruction:
            instructions,

        input: userMessage,

        tools
    });

    // ======================================
    // FUNCTION CALL LOOP
    // ======================================

    while (
        interaction.status === 'requires_action'
    ) {

        const functionCalls =
            (interaction.steps || [])
                .filter(
                    step =>
                        step.type ===
                        'function_call'
                );

        if (!functionCalls.length) {
            break;
        }

        const functionResults =
            functionCalls.map(call => {

                const result =
                    executeFunction(
                        call.name,
                        call.arguments || {}
                    );

                return {
                    type: 'function_result',
                    name: call.name,
                    call_id: call.id,
                    result: [
                        {
                            type: 'text',
                            text: JSON.stringify(result)
                        }
                    ]
                };
            });

        interaction = await geminiRequest({

            model: 'gemini-3.6-flash',

            previous_interaction_id:
                interaction.id,

            tools,

            input: functionResults
        });
    }

    const answer =
        extractText(interaction);

    if (!answer) {

        console.error(
            'Unexpected Gemini response:',
            JSON.stringify(
                interaction,
                null,
                2
            )
        );

        throw new Error(
            'Gemini returned no readable response'
        );
    }

    return answer
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^[-+]\s+/gm, '')
    .replace(/^-{3,}\s*$/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/`{1,3}/g, '')
    .trim();
}

// ==========================================
// CHAT API
// ==========================================

app.post('/api/chat', async (req, res) => {

    try {

        const userMessage =
            req.body.message || '';

        if (!userMessage.trim()) {

            return res.status(400).json({
                response:
                    'Please enter a question.'
            });
        }

        console.log(
            'User:',
            userMessage
        );

        const answer =
            await askGemini(userMessage);

        console.log(
            'AI:',
            answer
        );

        res.json({
            response: answer
        });

    } catch (error) {

        console.error(
            'Chat error:',
            error
        );

        res.status(500).json({
            response:
                `Gemini error: ${error.message}`
        });
    }
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/api/health', (req, res) => {

    res.json({

        status: 'ok',

        ai:
            Boolean(
                process.env.GEMINI_API_KEY
            ),

        model:
            'gemini-3.6-flash',

        functions: [
            'get_programs',
            'get_admission_contact',
            'get_fee',
            'get_apply_link'
        ]
    });
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {

    console.log('');
    console.log(
        '===================================='
    );

    console.log(
        'SVKM NMIMS AI ASSISTANT'
    );

    console.log(
        '===================================='
    );

    console.log(
        `Server: http://localhost:${PORT}`
    );

    console.log(
        `Gemini: ${
            process.env.GEMINI_API_KEY
                ? 'CONNECTED'
                : 'API KEY MISSING'
        }`
    );

    console.log(
        'Model: gemini-3.6-flash'
    );

    console.log(
        'Functions: 4 ENABLED'
    );

    console.log(
        '===================================='
    );

    console.log('');
});

