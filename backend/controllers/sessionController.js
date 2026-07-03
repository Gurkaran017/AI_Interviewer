// backend/controllers/sessionController.js
import asyncHandler from 'express-async-handler';
import Session from '../models/SessionModel.js';
import fetch from 'node-fetch'; // Standard for making HTTP requests (npm install node-fetch@2.6.1)
import fs from 'fs'; // <-- NEW: For reading and deleting the temporary file
import FormData from 'form-data'; // <-- NEW: For sending files to FastAPI
import path from 'path';
import mongoose from 'mongoose';
// URL for the Python AI Microservice (Must match Step 6 setup)
const AI_SERVICE_URL = process.env.AI_SERVICE_URL ;
console.log("AI_SERVICE_URL =", process.env.AI_SERVICE_URL);

// Helper function to send an update via Socket.io
const pushSocketUpdate = (io, userId, sessionId, status, message, session = null) => {
    // We target the user by their ID, assuming the user's socket is joined to a room named after their userId
    // (This room setup must be done on socket connection, which we will address later in server.js)
    io.to(userId.toString()).emit('sessionUpdate', {
        sessionId,
        status, // e.g., 'AI_GENERATING_QUESTIONS', 'QUESTIONS_READY', 'EVALUATION_FAILED'
        message,
        session,
    });
};

// @desc    Create a new interview session and start AI question generation
// @route   POST /api/sessions/
// @access  Private
const createSession = asyncHandler(async (req, res) => {
    const { role, level, interviewType, duration } = req.body;
    const userId = req.user._id;

    if (!role || !level || !interviewType || !duration) {
        res.status(400);
        throw new Error('Please specify role, level, interview type, and duration.');
    }

    // 1. Create the session placeholder in MongoDB
    let session = await Session.create({
        user: userId,
        role,
        level,
        interviewType,
        duration,
        status: 'pending',
    });

    const io = req.app.get('io');

    // 2. Immediately respond to the client (Latency Management)
    res.status(202).json({
        message: 'Session created. Generating initial question asynchronously...',
        sessionId: session._id,
        status: 'processing',
    });

    // --- ASYNCHRONOUS BACKGROUND TASK START ---

    // Using a self-executing async function to run the process in the background
    (async () => {
        try {
            // A. Notify the user via Socket.io that processing has started
            pushSocketUpdate(io, userId, session._id, 'AI_GENERATING_QUESTIONS', `Generating initial question for ${role}...`);

            // B. Call the Python AI Microservice   
            // backend/controllers/sessionController.js inside createSession
            const aiResponse = await fetch(`${AI_SERVICE_URL}/generate-questions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    role,
                    level,
                    count: 1, // Just generate ONE question to start
                    interview_type: interviewType 
                }),
            });
            console.log("AI Service responded with status: " ,aiResponse);

            if (!aiResponse.ok) {
                // If the AI service returns a non-200 status
                const errorBody = await aiResponse.text();
                throw new Error(`AI Service error: ${aiResponse.status} - ${errorBody}`);
            }

            const aiData = await aiResponse.json();
            const codingCount = interviewType === 'coding-mix' ? 1 : 0;
            // C. Map the raw questions into the structured Mongoose sub-document format
            const questionsArray = aiData.questions.map((qText, index) => ({
                questionText: qText,
                questionType: index < codingCount ? 'coding' : 'oral',
                isEvaluated: false,
                isSubmitted: false,
            }));

            // D. Update the session in MongoDB
            session.questions = questionsArray;
            session.status = 'in-progress';
            // REMOVED: session.startTime = Date.now(); 
            // We now set startTime only when the user clicks "Start Session"
            await session.save();

            // E. Push final result back to the client via Socket.io
            pushSocketUpdate(io, userId, session._id, 'QUESTIONS_READY', 'Question generated successfully. Starting session.', session);

        } catch (error) {
            // console.error(`Session Creation Failure for ${session._id}:`, error.message);
            console.error("ERROR:");
console.error(error);

            // F. Handle failure: Update status and notify client
            session.status = 'failed';
            await session.save();
            pushSocketUpdate(io, userId, session._id, 'GENERATION_FAILED', `Question generation failed. Reason: ${error.message}.`);
        }
    })();
});

// @desc    Get all interview sessions for the current user
// @route   GET /api/sessions/
// @access  Private
const getSessions = asyncHandler(async (req, res) => {
    // Find all sessions for the logged-in user, sorted by newest first
    const sessions = await Session.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .select('-questions.userAnswerText -questions.userSubmittedCode'); // Exclude heavy data for list view
    res.json(sessions);
});

// @desc    Get a specific session detail
// @route   GET /api/sessions/:id
// @access  Private
const getSessionById = asyncHandler(async (req, res) => {
    // Find session by ID and ensure it belongs to the logged-in user
    const session = await Session.findOne({ _id: req.params.id, user: req.user._id });

    if (session) {
        res.json(session);
    } else {
        res.status(404);
        throw new Error('Session not found or user unauthorized.');
    }
});

// @desc    Delete a session
// @route   DELETE /api/sessions/:id
// @access  Private
const deleteSession = asyncHandler(async (req, res) => {
    const session = await Session.findById(req.params.id);

    if (!session) {
        res.status(404);
        throw new Error('Session not found');
    }

    // Check if the user owns this session
    if (session.user.toString() !== req.user.id) {
        res.status(401);
        throw new Error('Not authorized');
    }

    await session.deleteOne();

    res.status(200).json({ id: req.params.id });
});

const evaluateAnswerAsync = async (io, userId, sessionId, questionIndex, audioFilePath = null, code = null) => {
    console.log("\n==============================");
    console.log("evaluateAnswerAsync STARTED");
    console.log("Session:", sessionId);
    console.log("Question:", questionIndex);
    console.log("Audio:", audioFilePath);
    console.log("Code exists:", !!code);
    console.log("==============================");
    const processingStart = Date.now(); // TRACK START OF AI PROCESSING
    // Initialize transcription as an empty string instead of null to avoid "null" text in AI prompts
    let transcription = ""; 

    const questionIdx = typeof questionIndex === 'string' ? parseInt(questionIndex, 10) : questionIndex;

    const session = await Session.findById(sessionId);
    if (!session) {
        // console.error(`Session ${sessionId} not found`);
        console.error("ERROR:");
console.error(error);
        return;
    }

    const question = session.questions[questionIdx];
    if (!question) {
        pushSocketUpdate(io, userId, sessionId, 'EVALUATION_FAILED', `Q${questionIdx + 1} not found.`, null);
        return;
    }

    // --- Phase 1: Transcription (Only if audio exists) ---
    if (audioFilePath) {
        try {
            pushSocketUpdate(io, userId, sessionId, 'AI_TRANSCRIBING', `Transcribing audio for Q${questionIdx + 1}...`);
            const formData = new FormData();
            formData.append('file', fs.createReadStream(audioFilePath));

            console.log("Sending audio to AI...");
            console.log("File exists:", fs.existsSync(audioFilePath));
            console.log("File size:", fs.statSync(audioFilePath).size, "bytes");

            const transResponse = await fetch(`${AI_SERVICE_URL}/transcribe`, {
                method: 'POST',
                body: formData,
                headers: formData.getHeaders(),
            });

            console.log("Transcribe API Status:", transResponse.status);

            if (!transResponse.ok) throw new Error('Transcription service failed');

            const transData = await transResponse.json();
            console.log("Transcript received:");
            console.log(transData);
            transcription = transData.transcription || "";
        } catch (error) {
            // console.error(`Transcription Error: ${error.message}`);
            console.error("ERROR:");
console.error(error);
            // We continue even if transcription fails so the code can still be evaluated
        } finally {
            if (audioFilePath && fs.existsSync(audioFilePath)) fs.unlinkSync(audioFilePath);
        }
    }

    // --- Phase 2: AI Evaluation ---
    try {
        pushSocketUpdate(io, userId, sessionId, 'AI_EVALUATING', `AI is analyzing Q${questionIdx + 1}...`);


        console.log("Sending transcript to evaluate...");
        console.log("Transcript:");
        console.log(transcription);
        console.log("Code:");
        console.log(code);

        const evalResponse = await fetch(`${AI_SERVICE_URL}/evaluate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: question.questionText,
                question_type: question.questionType, // Tells AI if it should expect code
                role: session.role,
                level: session.level,
                user_answer: transcription, // Dedicated transcription field
                user_code: code || "",      // Dedicated code field
            }),
        });

        if (!evalResponse.ok) throw new Error('AI Evaluation service failed');

        const evalData = await evalResponse.json();

        console.log("Evaluation completed.");
        console.log(evalData);

        // --- Phase 3: Correct MongoDB Mapping ---
        // Store them strictly in their respective fields
        question.userAnswerText = transcription; 
        question.userSubmittedCode = code || ""; 

        question.technicalScore = evalData.technicalScore;
        question.confidenceScore = evalData.confidenceScore;
        question.aiFeedback = evalData.aiFeedback;
        question.idealAnswer = evalData.idealAnswer;
        question.isEvaluated = true;

        // Ensure session remains completed if previously marked by client/timer
        if (session.status === 'completed') {
            const scoreSummary = await calculateOverallScore(sessionId);
            session.overallScore = scoreSummary.overallScore || 0;
            session.metrics = {
                avgTechnical: scoreSummary.avgTechnical,
                avgConfidence: scoreSummary.avgConfidence,
            };
            await session.save();
            pushSocketUpdate(io, userId, sessionId, 'SESSION_COMPLETED', 'Scores finalized.', session);
        } else {
            // Check if timer expired based on duration on server side as a fallback
            const timeElapsed = (new Date() - new Date(session.startTime)) / 60000;
            if (timeElapsed >= session.duration) {
                // Time is up, finish session
                const scoreSummary = await calculateOverallScore(sessionId);
                session.overallScore = scoreSummary.overallScore || 0;
                session.metrics = { avgTechnical: scoreSummary.avgTechnical, avgConfidence: scoreSummary.avgConfidence };
                session.status = 'completed';
                session.endTime = new Date();
                await session.save();
                pushSocketUpdate(io, userId, sessionId, 'SESSION_COMPLETED', 'Time is up. Scores finalized.', session);
            } else {
                // Session is ongoing. Generate Next Adaptive Question
                pushSocketUpdate(io, userId, sessionId, 'AI_GENERATING_QUESTIONS', 'Generating next adaptive question...');
                
                try {
                    console.log("Generating next question...");
                    const nextQResponse = await fetch(`${AI_SERVICE_URL}/generate-next-question`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            role: session.role,
                            level: session.level,
                            interview_type: session.interviewType,
                            previous_question: question.questionText,
                            user_answer: question.userAnswerText,
                            user_code: question.userSubmittedCode,
                            ai_feedback: question.aiFeedback
                        }),
                    });

                    if (nextQResponse.ok) {
                        const nextQData = await nextQResponse.json();
                        session.questions.push({
                            questionText: nextQData.question,
                            questionType: nextQData.questionType || 'oral',
                            isEvaluated: false,
                            isSubmitted: false,
                        });
                        console.log("Next question:");
                        console.log(nextQData);
                    }
                } catch (e) {
                    // console.error("Failed to generate next question:", e);
                    console.error("ERROR:");
console.error(error);
                }

                // UNIFIED PERSISTENT PAUSE CALCULATION
                if (session.lastPauseStart) {
                    const processingDuration = Date.now() - new Date(session.lastPauseStart).getTime();
                    session.pauseTimeMS = (session.pauseTimeMS || 0) + processingDuration;
                }
                session.isPaused = false; 

                await session.save();
                pushSocketUpdate(io, userId, sessionId, 'NEW_QUESTION', `Feedback ready and new question available.`, session);
            }
        }

    } catch (error) {
        // console.error(`Evaluation Error: ${error.message}`);
        console.error("ERROR:");
console.error(error);
        session.isPaused = false; // Always unlock on failure
        await session.save();
        pushSocketUpdate(io, userId, sessionId, 'EVALUATION_FAILED', `Evaluation failed.`, session);
    }
};

// @desc    Submit an answer (Audio or Code)
// @route   POST /api/sessions/:id/submit-answer
// @access  Private
const submitAnswer = asyncHandler(async (req, res) => {
    console.log("========== SUBMIT ANSWER ==========");
    console.log("Session:", req.params.id);
    console.log("Question:", req.body.questionIndex);
    console.log("Has file:", !!req.file);
    console.log("Has code:", !!req.body.code);
    const sessionId = req.params.id;
    const { questionIndex, code, violations } = req.body; 
    const userId = req.user._id;

    const session = await Session.findById(sessionId);

    if (!session || session.user.toString() !== userId.toString()) {
        res.status(404);
        throw new Error('Session not found or user unauthorized.');
    }

    const questionIdx = parseInt(questionIndex, 10);
    const question = session.questions[questionIdx];

    if (!question) {
        res.status(400);
        throw new Error(`Question at index ${questionIdx} not found.`);
    }

    // --- NEW UNIFIED LOGIC ---
    let audioFilePath = null;
    if (req.file) {
        audioFilePath = path.join(process.cwd(), req.file.path);
    }
    console.log("Audio path:", audioFilePath);

    // We no longer error out if one is missing; 
    // we take whatever is provided (audio, code, or both).
    const codeSubmission = code || null;

    // 1. Update status in DB and LOCK TIMER
    question.isSubmitted = true;
    session.isPaused = true;
    session.lastPauseStart = new Date();
    
    // Update violations if provided
    if (violations !== undefined) {
        session.violations = Number(violations);
    }
    
    await session.save();

    // 2. Respond immediately
    res.status(202).json({
        message: 'Answer received. Timer frozen locally and on server.',
        status: 'received',
        session
    });

    const io = req.app.get('io');

    console.log("Calling evaluateAnswerAsync...");
    // 3. Start AI processing with BOTH potential inputs
    evaluateAnswerAsync(io, userId, sessionId, questionIdx, audioFilePath, codeSubmission);
});


const calculateOverallScore = async (sessionId) => {
    const results = await Session.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(sessionId) } },
        { $unwind: '$questions' },
        {
            $group: {
                _id: '$_id',
                avgTechnical: {
                    $avg: { $cond: [{ $eq: ['$questions.isEvaluated', true] }, '$questions.technicalScore', 0] }
                },
                avgConfidence: {
                    $avg: { $cond: [{ $eq: ['$questions.isEvaluated', true] }, '$questions.confidenceScore', 0] }
                }
            }
        },
        {
            $project: {
                _id: 0,
                overallScore: { $round: [{ $avg: ['$avgTechnical', '$avgConfidence'] }, 0] },
                avgTechnical: { $round: ['$avgTechnical', 0] },
                avgConfidence: { $round: ['$avgConfidence', 0] },
            }
        }
    ]); 

    const finalResult = results[0] || { overallScore: 0, avgTechnical: 0, avgConfidence: 0 };
    
    // --- Phase 4: Apply Violation Penalty ---
    const session = await Session.findById(sessionId);
    if (session && session.violations > 0) {
        const deductionPercent = Math.min(session.violations * 5, 80);
        const factor = (100 - deductionPercent) / 100;
        finalResult.overallScore = Math.round(finalResult.overallScore * factor);
    }

    return finalResult;
};
// @desc    End the session early
// @route   POST /api/sessions/:id/end
// @access  Private
const endSession = asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user._id;

    const session = await Session.findById(sessionId);

    if (!session || session.user.toString() !== userId.toString()) {
        res.status(404);
        throw new Error('Session not found or user unauthorized.');
    }
    const isProcessing = session.questions.some(q => q.isSubmitted && !q.isEvaluated);
    if (isProcessing) {
        res.status(400);
        throw new Error('Cannot end interview while AI is processing answers.');
    }
    if (session.status === 'completed') {
        res.status(400);
        throw new Error('Session is already completed.');
    }

    // Calculate scores for evaluated questions
    const scoreSummary = await calculateOverallScore(sessionId);

    session.overallScore = scoreSummary.overallScore || 0;
    session.status = 'completed';
    session.endTime = new Date();
    session.metrics = {
        avgTechnical: scoreSummary.avgTechnical,
        avgConfidence: scoreSummary.avgConfidence,
    };

    await session.save();

    const io = req.app.get('io');
    pushSocketUpdate(io, userId, sessionId, 'SESSION_COMPLETED', 'Interview session ended early.', session);

    res.json({ message: 'Session ended successfully.', session });
});

// @desc    Start the session timer
// @route   POST /api/sessions/:id/start
// @access  Private
const startSession = asyncHandler(async (req, res) => {
    const session = await Session.findById(req.params.id);

    if (!session || session.user.toString() !== req.user._id.toString()) {
        res.status(404);
        throw new Error('Session not found or user unauthorized.');
    }

    // Only set startTime once
    if (!session.startTime) {
        session.startTime = new Date();
        session.status = 'in-progress';
        await session.save();
    }

    res.json(session);
});

export {
    createSession,
    getSessionById,
    getSessions,
    submitAnswer,
    endSession,
    calculateOverallScore,
    deleteSession,
    startSession
};


