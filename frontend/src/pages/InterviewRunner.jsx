// frontend/src/pages/InterviewRunner.jsx
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useParams, useNavigate } from 'react-router-dom';
import { getSessionById, submitAnswer, endSession, socketUpdateSession, startSession } from '../features/sessions/sessionSlice';
import MonacoEditor from '@monaco-editor/react';
import { toast } from 'react-toastify';
import { io } from 'socket.io-client';
import Modal from '../components/Modal';

function formatTime(seconds) {
  if (seconds === null || isNaN(seconds) || seconds < 0) return "00:00";
  const safeSec = Math.min(seconds, 3600 * 99); 
  const m = Math.floor(safeSec / 60).toString().padStart(2, '0');
  const s = (Math.floor(safeSec) % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const SUPPORTED_LANGUAGES = [
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'Python', value: 'python' },
  { label: 'Java', value: 'java' },
  { label: 'C++', value: 'cpp' },
  { label: 'Go', value: 'go' },
  { label: 'SQL', value: 'sql' },
  { label: 'Plain Text', value: 'plaintext' },
];

const ROLE_LANGUAGE_MAP = {
  "MERN Stack Developer": "javascript",
  "Frontend Developer": "javascript",
  "Backend Developer": "javascript",
  "Data Scientist": "python",
  "Product Manager": "markdown"
};

function InterviewRunner() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { activeSession } = useSelector(state => state.sessions);

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedLanguage, setSelectedLanguage] = useState('javascript');
  const [submittedLocal, setSubmittedLocal] = useState({});

  const [drafts, setDrafts] = useState(() => {
    const saved = localStorage.getItem(`drafts_${sessionId}`);
    return saved ? JSON.parse(saved) : {};
  });

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [timeLeft, setTimeLeft] = useState(null);
  
  const [hasJoined, setHasJoined] = useState(false);
  const [isTerminated, setIsTerminated] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [model, setModel] = useState(null);
  const [proctorWarning, setProctorWarning] = useState("");
  const [proctorStatus, setProctorStatus] = useState("Initializing AI...");
  const [violationCount, setViolationCount] = useState(0);
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);

  const socketRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const sessionTimerRef = useRef(null);
  const videoRef = useRef(null);
  const videoStreamRef = useRef(null);
  const detectionIntervalRef = useRef(null);
  const faceLossCounterRef = useRef(0);

  const currentQuestion = useMemo(() => activeSession?.questions?.[currentQuestionIndex] || null, [activeSession?.questions, currentQuestionIndex]);
  const isReduxSubmitted = currentQuestion?.isSubmitted === true;
  const isLocallySubmitted = submittedLocal[currentQuestionIndex] === true;
  const isQuestionLocked = isReduxSubmitted || isLocallySubmitted;

  const isWaitingForAI = useMemo(() => {
     if (!isQuestionLocked) return false;
     if (!currentQuestion?.isEvaluated) return true;
     if (activeSession?.questions?.length <= currentQuestionIndex + 1) return true;
     return false;
  }, [isQuestionLocked, currentQuestion?.isEvaluated, activeSession?.questions?.length, currentQuestionIndex]);

  // SOCKET: Real-time update listener
  useEffect(() => {
    const userJson = localStorage.getItem('user');
    if (userJson) {
       const user = JSON.parse(userJson);
       const endpoint = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace('/api', '');
       socketRef.current = io(endpoint, { query: { userId: user._id } });
       
       socketRef.current.on('sessionUpdate', (data) => {
         if (data.sessionId === sessionId) {
            dispatch(socketUpdateSession(data));
         }
       });
    }
    return () => socketRef.current?.disconnect();
  }, [dispatch, sessionId]);

  // Anti-Cheat: Visibility
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && hasJoined && !isTerminated) {
        setViolationCount(v => v + 1);
        toast.error("Integrity Warning: Focus Lost!", { position: "top-center" });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [hasJoined, isTerminated]);

  // AI Proctor Loader
  useEffect(() => {
    const poll = setInterval(async () => {
       if (window.tf && window.cocoSsd) {
          clearInterval(poll);
          try {
             await window.tf.ready();
             const loadedModel = await window.cocoSsd.load();
             setModel(loadedModel);
             setProctorStatus("AI PROCTOR: ACTIVE");
          } catch (e) { setProctorStatus("AI PROCTOR: ERR"); }
       }
    }, 1000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => { if (sessionId) dispatch(getSessionById(sessionId)); }, [dispatch, sessionId]);
  useEffect(() => {
    if (activeSession?.role) setSelectedLanguage(ROLE_LANGUAGE_MAP[activeSession.role] || "plaintext");
    if (activeSession?.questions?.length > 0) setCurrentQuestionIndex(activeSession.questions.length - 1);
  }, [activeSession?.role, activeSession?.questions?.length]);
  useEffect(() => { localStorage.setItem(`drafts_${sessionId}`, JSON.stringify(drafts)); }, [drafts, sessionId]);

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Proctor Loop
  useEffect(() => {
    if (hasJoined && model && videoRef.current && !isTerminated) {
        detectionIntervalRef.current = setInterval(async () => {
           if (videoRef.current?.readyState === 4) {
              try {
                const predictions = await model.detect(videoRef.current);
                const hasPerson = predictions.some(p => p.class === 'person');
                const hasPhone = predictions.some(p => p.class === 'cell phone');
                
                if (hasPhone) {
                  setProctorWarning("SECURITY ALERT: Cell phone detected!");
                  setViolationCount(v => v + 1);
                  toast.error("Violation: Mobile phone use prohibited.");
                } else if (!hasPerson) {
                   faceLossCounterRef.current += 1;
                   if (faceLossCounterRef.current >= 2) { 
                      setProctorWarning("WARNING: Face not detected!");
                      setViolationCount(v => v + 1);
                      toast.error("Violation: Candidate left frame.");
                   }
                } else {
                   faceLossCounterRef.current = 0;
                   setProctorWarning("");
                }
              } catch (e) {}
           }
        }, 4000);
    }
    return () => clearInterval(detectionIntervalRef.current);
  }, [hasJoined, model, isTerminated]);

  // --- SMART SERVER-SYNCED TIMER ---
  useEffect(() => {
    if (isTerminated) return;

    if (hasJoined && activeSession?.startTime) {
       const durationSec = (activeSession.duration || 10) * 60;
       const startTimeMs = new Date(activeSession.startTime).getTime();
       const pauseOffsetMS = activeSession.pauseTimeMS || 0;

       if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
       sessionTimerRef.current = setInterval(() => {
          // --- PERSISTENT PAUSE LOGIC ---
          // Use the exact pause-start timestamp if the server says it's paused.
          // Otherwise use the current time.
          const effectiveNow = activeSession.isPaused && activeSession.lastPauseStart 
             ? new Date(activeSession.lastPauseStart).getTime() 
             : Date.now();

          const totalElapsedSec = Math.max(0, (effectiveNow - startTimeMs - pauseOffsetMS) / 1000);
          const remainingSec = Math.max(0, durationSec - totalElapsedSec);
          
          if (remainingSec <= 0 && durationSec > 0) {
             setTimeLeft(0);
             clearInterval(sessionTimerRef.current);
             terminateInterview(); 
          } else {
             setTimeLeft(remainingSec);
          }
       }, 1000);
    }
    return () => clearInterval(sessionTimerRef.current);
  }, [isWaitingForAI, hasJoined, activeSession?.startTime, activeSession?.duration, activeSession?.pauseTimeMS, activeSession?.isPaused, activeSession?.lastPauseStart, isTerminated]);

  // TTS
  useEffect(() => {
    if (hasJoined && currentQuestion?.questionText && !isQuestionLocked && !isTerminated) {
       window.speechSynthesis.cancel();
       const msg = new SpeechSynthesisUtterance(currentQuestion.questionText);
       msg.onstart = () => setIsSpeaking(true);
       msg.onend = () => setIsSpeaking(false);
       window.speechSynthesis.speak(msg);
    }
    return () => window.speechSynthesis.cancel();
  }, [currentQuestionIndex, currentQuestion?.questionText, hasJoined, isQuestionLocked, isTerminated]);

  const handleJoin = async () => {
      const elem = document.documentElement;
      if (elem.requestFullscreen) elem.requestFullscreen().catch(()=>{});
      try {
         const stream = await navigator.mediaDevices.getUserMedia({ video: true });
         videoStreamRef.current = stream;
      } catch (err) { toast.error("Camera required."); return; }
      
      // Call StartSession to officially kick off the timer
      try {
         await dispatch(startSession(sessionId)).unwrap();
         setHasJoined(true);
      } catch (e) {
         toast.error("Failed to start session timer.");
      }
  };

  const startRecording = async () => {
    if (isQuestionLocked) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setDrafts(p => ({ ...p, [currentQuestionIndex]: { ...p[currentQuestionIndex], audioBlob: blob } }));
      };
      mediaRecorderRef.current.start(); 
      setIsRecording(true);
      setRecordingTime(0);
      timerIntervalRef.current = setInterval(() => setRecordingTime(p => p + 1), 1000);
    } catch (err) { toast.error("Mic error."); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
      clearInterval(timerIntervalRef.current);
      setIsRecording(false);
    }
  };

  const handleSubmit = async () => {
    if (isQuestionLocked) return;
    if (isRecording) stopRecording();
    const draft = drafts[currentQuestionIndex];
    if (!draft?.code && !draft?.audioBlob) { toast.warning("Submit answer."); return; }
    
    setSubmittedLocal(p => ({ ...p, [currentQuestionIndex]: true }));
    window.speechSynthesis.cancel(); 
    
    const formData = new FormData();
    formData.append('questionIndex', currentQuestionIndex);
    formData.append('violations', violationCount);
    if (draft.code) formData.append('code', draft.code);
    if (draft.audioBlob) formData.append('audioFile', draft.audioBlob, 'answer.webm');
    
    dispatch(submitAnswer({ sessionId, formData })).unwrap().catch(() => {
        setSubmittedLocal(p => ({ ...p, [currentQuestionIndex]: false }));
        toast.error("Retry submission.");
    });
  };

  const terminateInterview = () => {
    setIsTerminated(true);
    window.speechSynthesis.cancel();
    if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    
    // STOP CAMERA TRACKS IMMEDIATELY
    if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(track => track.stop());
        videoStreamRef.current = null;
    }

    dispatch(endSession(sessionId)).unwrap().then(() => {
        localStorage.removeItem(`drafts_${sessionId}`);
    });
  };

  const currentDraft = drafts[currentQuestionIndex] || {};

  if (!activeSession) return <div className="min-h-screen flex items-center justify-center bg-slate-900 text-teal-400 font-bold">RECONSTRUCTING DATA...</div>;

  // --- THANK YOU / CONCLUSION SCREEN ---
  if (isTerminated) {
     return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center animate-in fade-in zoom-in duration-700">
           <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100 max-w-2xl w-full">
              <div className="w-20 h-20 bg-teal-500/10 text-teal-600 rounded-3xl flex items-center justify-center text-4xl mb-8 mx-auto">🎉</div>
              <h1 className="text-4xl font-black text-slate-900 mb-4 uppercase tracking-tighter">Interview Complete!</h1>
              <p className="text-slate-500 mb-10 font-medium leading-relaxed">
                 Thank you for your time and effort. We have logged your performance, integrity metrics, and AI technical evaluations. 
                 A comprehensive report is now ready for your review.
              </p>
              <button onClick={() => navigate(`/review/${sessionId}`)} className="w-full py-5 bg-teal-600 text-white font-black text-xl rounded-3xl hover:bg-teal-500 transition-all shadow-xl shadow-teal-500/20 active:scale-95 uppercase tracking-widest">
                 View Global Analysis
              </button>
           </div>
           <p className="mt-10 text-[10px] font-black text-slate-300 uppercase tracking-widest">Assessment System v2.0 • Secured by AI Proctor</p>
        </div>
     );
  }

  // Waiting Room
  if (!hasJoined) {
     return (
       <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white p-6">
          <h1 className="text-4xl font-black mb-4 uppercase tracking-tighter">Secure Waiting Room</h1>
          <p className="text-slate-400 mb-10 max-w-sm text-center">The timer will only start ticking once you join. All AI processing time is excluded.</p>
          {!(activeSession?.questions?.length > 0) ? (
             <div className="flex flex-col items-center gap-4"><div className="w-10 h-10 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div><p className="text-xs font-black uppercase text-teal-400">Loading Adaptive Content...</p></div>
          ) : (
             <button onClick={handleJoin} className="px-16 py-5 bg-teal-600 text-white font-black text-xl rounded-2xl hover:bg-teal-500 transition-all shadow-xl shadow-teal-500/20 active:scale-95 uppercase tracking-widest">ENTER INTERVIEW</button>
          )}
       </div>
     );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center z-20 sticky top-0 shadow-xl">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 bg-white/5 flex items-center justify-center rounded-xl border border-white/10 ${isSpeaking ? 'ring-2 ring-teal-500' : ''}`}>
             <span className="text-2xl">🤖</span>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">{activeSession.role}</h1>
            <div className="flex items-center gap-2">
               <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${proctorStatus.includes('ACTIVE') ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-300'}`}>{proctorStatus}</span>
               {isWaitingForAI && <span className="text-[9px] font-black uppercase bg-amber-500 text-slate-900 px-2 py-0.5 rounded animate-pulse">CLOCK PAUSED</span>}
               {violationCount > 0 && <span className="text-[9px] font-black uppercase bg-rose-600 text-white px-2 py-0.5 rounded">Security Logged</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
           <div className={`flex flex-col items-end pr-4 border-r border-white/10`}>
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Time Remaining</span>
              <span className={`font-mono text-2xl font-black tabular-nums transition-colors ${timeLeft < 120 ? 'text-rose-500' : 'text-white'}`}>
                 {formatTime(timeLeft)}
              </span>
           </div>
           <button onClick={() => setIsExitModalOpen(true)} className="text-[10px] font-black bg-rose-600/20 text-rose-500 border border-rose-600/50 hover:bg-rose-600 hover:text-white px-3 py-2 rounded-lg tracking-widest">QUICK EXIT</button>
        </div>
      </div>

      <Modal 
         isOpen={isExitModalOpen}
         onClose={() => setIsExitModalOpen(false)}
         onConfirm={terminateInterview}
         title="End Interview?"
         message="Are you sure you want to exit? Your answers submitted so far will be saved and evaluated, but you cannot return to this session."
         confirmText="End & Analyze"
         type="info"
      />

      <div className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-8 flex flex-col gap-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
           
           <div className="lg:col-span-4 flex flex-col gap-6">
              <div className="bg-black rounded-[2.5rem] overflow-hidden shadow-2xl relative border-4 border-white aspect-video bg-slate-950">
                 <video ref={(v) => { if(v){ videoRef.current = v; if(videoStreamRef.current && !v.srcObject) v.srcObject = videoStreamRef.current; } }} autoPlay muted playsInline className="w-full h-full object-cover -scale-x-100" />
                 {proctorWarning && <div className="absolute inset-x-0 bottom-0 bg-rose-600 font-bold p-3 text-center text-white text-[11px] uppercase z-10 animate-pulse">{proctorWarning}</div>}
              </div>

              <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col min-h-[250px] relative overflow-hidden">
                 <div className="absolute -right-10 -top-10 w-32 h-32 bg-teal-500/5 rounded-full blur-[40px]"></div>
                 <span className="text-[10px] font-black text-teal-600 uppercase tracking-[0.2em] mb-4 border-l-2 border-teal-500 pl-3">Live Question</span>
                 <h2 className="text-xl font-bold text-slate-800 leading-relaxed whitespace-pre-wrap flex-1 z-10">{currentQuestion?.questionText}</h2>
              </div>
           </div>

           <div className="lg:col-span-8 flex flex-col gap-6">
              <div className="bg-white p-6 rounded-[2rem] border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
                 <div className="flex items-center gap-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">🎙️ Verbal Response</div>
                 <div className="flex items-center gap-6">
                     {!isRecording && !currentDraft.audioBlob ? (
                        <button onClick={startRecording} disabled={isQuestionLocked} className="px-8 py-3 bg-slate-900 text-white rounded-full text-[10px] font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95 disabled:opacity-30">Record Answer</button>
                     ) : isRecording ? (
                        <div className="flex items-center gap-4"><span className="font-mono text-xl font-bold tabular-nums">00:{recordingTime.toString().padStart(2, '0')}</span><button onClick={stopRecording} className="px-8 py-3 bg-rose-600 text-white rounded-full text-[10px] font-black uppercase animate-pulse">Stop Recording</button></div>
                     ) : (
                        <div className="flex items-center gap-3 px-6 py-3 bg-emerald-50 rounded-full border border-emerald-100"><span className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">Audio Ready</span>{!isQuestionLocked && <button onClick={()=>setDrafts(p=>({...p, [currentQuestionIndex]:{...p[currentQuestionIndex], audioBlob:null}}))} className="text-rose-500 text-[9px] font-black uppercase hover:underline ml-2">Delete</button>}</div>
                     )}
                 </div>
              </div>

              <div className="bg-[#1e1e1e] rounded-[2.5rem] shadow-2xl flex flex-col border border-black overflow-hidden" style={{ height: '380px' }}>
                 <div className="flex justify-between items-center px-8 py-3 bg-[#181818] border-b border-black">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Implementation Sandbox</span>
                    <select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)} disabled={isQuestionLocked} className="text-[10px] bg-[#2d2d2d] text-slate-300 border-none rounded-lg px-4 py-1.5 font-bold outline-none cursor-pointer">
                       {SUPPORTED_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                 </div>
                 <div className="flex-1 relative"><MonacoEditor language={selectedLanguage} theme="vs-dark" value={currentDraft.code || ''} onChange={(c)=>{ if(!isQuestionLocked) setDrafts(p=>({...p,[currentQuestionIndex]:{...p[currentQuestionIndex],code:c}})); }} options={{ minimap:{enabled:false}, fontSize:14, padding:{top:25, bottom:25}, readOnly:isQuestionLocked, scrollBeyondLastLine:false, smoothScrolling:true, lineNumbersMinChars: 3 }} /></div>
              </div>

              <div className="flex justify-center">
                 <button 
                  onClick={handleSubmit} 
                  disabled={isQuestionLocked || isWaitingForAI} 
                  className={`w-full py-5 rounded-[2rem] font-black tracking-widest uppercase text-xs shadow-2xl transition-all ${isWaitingForAI ? 'bg-amber-100 text-amber-600 cursor-not-allowed' : isQuestionLocked ? 'bg-emerald-50 text-emerald-600' : 'bg-teal-600 hover:bg-teal-500 text-white active:scale-95'}`}
                 >
                    {isWaitingForAI ? "PROCESSING RESPONSE..." : isQuestionLocked ? "LOCKED • PREPARING NEXT" : "SUBMIT & PROCEED"}
                 </button>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}

export default InterviewRunner;