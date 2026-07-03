// frontend/src/pages/SessionReview.jsx
import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useParams, Link } from 'react-router-dom';
import { getSessionById } from '../features/sessions/sessionSlice';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const formatDuration = (start, end) => {
    if (!start || !end) return 'N/A';
    const diff = new Date(end) - new Date(start);
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
};

const getSelectionOdds = (score) => {
    if (score >= 90) return { label: "High (Candidate of Choice)", color: "text-emerald-600", desc: "Your performance is exceptional. You are in the top 5% of candidates for this role." };
    if (score >= 75) return { label: "Strong (Highly Recommend)", color: "text-blue-600", desc: "You showed great technical depth and confidence. You have a very high chance of clearing this round." };
    if (score >= 55) return { label: "Moderate (Borderline)", color: "text-amber-600", desc: "You have basic competency but may face stiff competition. Polishing your communication will help." };
    return { label: "Low (Requires Retraining)", color: "text-rose-600", desc: "Based on this session, you are not yet ready for this role. We recommend more practice with the AI." };
};

const formatIdealAnswer = (text) => {
    if (!text || text === "pending") return "Model explanation not generated.";
    try {
        let cleanText = text.trim();
        if (cleanText.startsWith('```')) {
            cleanText = cleanText.replace(/^```(json|javascript|python)?/, '').replace(/```$/, '').trim();
        }
        if (cleanText.startsWith('{') && cleanText.endsWith('}')) {
            const parsed = JSON.parse(cleanText);
            return parsed.idealAnswer || parsed.explanation || parsed.answer || cleanText;
        }
        return cleanText;
    } catch (e) { return text; }
};

function SessionReview() {
    const { sessionId } = useParams();
    const dispatch = useDispatch();
    const { activeSession, isLoading } = useSelector(state => state.sessions);

    useEffect(() => {
        dispatch(getSessionById(sessionId));
    }, [dispatch, sessionId]);

    if (isLoading) return <div className="text-center py-20 font-black text-teal-600 animate-pulse tracking-[0.2em] uppercase">Generating Proctored Report...</div>;

    if (!activeSession || activeSession.status !== 'completed') {
        return (
            <div className="max-w-xl mx-auto mt-20 p-10 bg-white rounded-[3rem] shadow-2xl text-center border border-slate-100">
                <h2 className="text-2xl font-black text-slate-800 mb-4 tracking-tighter uppercase">Analyzing Session...</h2>
                <p className="text-slate-500 mb-8 font-medium">Please wait while our AI completes the final behavioral and technical assessment.</p>
                <Link to="/" className="inline-block bg-teal-600 text-white px-10 py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl transition hover:bg-teal-700 active:scale-95 text-sm">Return Home</Link>
            </div>
        );
    }

    const { overallScore, metrics, role, level, questions, startTime, endTime, violations = 0 } = activeSession;
    const finalMetrics = metrics || {};
    const integrityScore = Math.max(100 - (violations * 5), 20);
    const selectionOdds = getSelectionOdds(overallScore);

    const barData = {
        labels: questions.map((_, i) => `Q${i + 1}`),
        datasets: [{
            label: 'Score',
            data: questions.map(q => q.technicalScore || 0),
            backgroundColor: questions.map(q => (q.technicalScore || 0) > 70 ? '#10b981' : '#f59e0b'),
            borderRadius: 12,
        }],
    };

    return (
        <div className="max-w-7xl mx-auto px-6 py-12 space-y-12 animate-in fade-in duration-1000 bg-slate-50/30 font-sans">

            {/* HEADER & TOP STATS */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-8">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                       <span className="w-3 h-3 bg-teal-500 rounded-full"></span>
                       <span className="text-teal-600 font-black uppercase tracking-[0.3em] text-[10px]">Session Analysis Report</span>
                    </div>
                    <h1 className="text-4xl sm:text-6xl font-black text-slate-900 tracking-tighter uppercase leading-none">
                        {role} <span className="text-slate-300 font-light block sm:inline">({level})</span>
                    </h1>
                </div>
                <div className="flex items-center gap-4 bg-white p-4 rounded-3xl shadow-sm border border-slate-100">
                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Final Scrape</span>
                    <span className="text-5xl font-black text-teal-600 tracking-tighter">{overallScore}%</span>
                </div>
            </div>

            {/* EXPANDED STATS GRID */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                {[
                    { label: 'Integrity', value: `${integrityScore}%`, color: integrityScore < 80 ? 'rose' : 'emerald', desc: `${violations} Violations` },
                    { label: 'Technical', value: `${finalMetrics.avgTechnical}%`, color: 'slate', desc: 'Average depth' },
                    { label: 'Communication', value: `${finalMetrics.avgConfidence}%`, color: 'slate', desc: 'Clarity & Confidence' },
                    { label: 'Interview Time', value: formatDuration(startTime, endTime), color: 'slate', desc: 'Active Session' },
                    { label: 'Selection Chance', value: selectionOdds.label.split('(')[0], color: 'slate', desc: 'Market Probability' },
                ].map((stat, i) => (
                    <div key={i} className={`bg-white p-6 rounded-[2.5rem] shadow-sm border-t-8 border-slate-900`}>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{stat.label}</p>
                        <p className="text-3xl font-black text-slate-900 mt-2 tracking-tighter">{stat.value}</p>
                        <p className={`text-[10px] font-bold mt-2 uppercase text-slate-400`}>{stat.desc}</p>
                    </div>
                ))}
            </div>

            {/* SELECTION PREDICTION BAR */}
            <div className="bg-white p-10 rounded-[3.5rem] shadow-sm border border-slate-100 flex flex-col md:flex-row items-center gap-10">
                <div className="flex-1">
                   <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] mb-4">Market Probability Assessment</h3>
                   <div className="flex items-center gap-4">
                      <span className={`text-3xl font-black ${selectionOdds.color}`}>{selectionOdds.label}</span>
                   </div>
                   <p className="text-slate-500 mt-4 text-sm font-medium leading-relaxed">{selectionOdds.desc}</p>
                </div>
                <div className="w-full md:w-64 h-3 bg-slate-100 rounded-full overflow-hidden relative">
                    <div className="h-full bg-teal-500 transition-all duration-1000" style={{ width: `${overallScore}%` }}></div>
                </div>
            </div>

            {/* PERFORMANCE CHART */}
            <div className="bg-white p-10 rounded-[3.5rem] shadow-sm border border-slate-100">
                <h3 className="text-xs font-black text-slate-400 mb-8 uppercase tracking-[0.3em]">Adaptive Question Matrix</h3>
                <div className="h-64">
                    <Bar
                        data={barData}
                        options={{
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: { beginAtZero: true, max: 100, grid: { color: '#f1f5f9' } },
                                x: { grid: { display: false } }
                            }
                        }}
                    />
                </div>
            </div>

            {/* QUESTION INTELLIGENCE - FULL DISCLOSURE */}
            <div className="space-y-10">
                <div className="flex items-center gap-4 px-4">
                   <div className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center text-xl font-black italic">✓</div>
                   <h3 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Individual Performance Grid</h3>
                </div>
                
                <div className="space-y-10">
                    {questions.map((q, index) => (
                        <div key={index} className="bg-white rounded-[3.5rem] border border-slate-100 shadow-sm overflow-hidden group hover:shadow-2xl transition-all duration-1000">
                            <div className="p-10 space-y-8">
                                {/* Header */}
                                <div className="flex flex-col lg:flex-row justify-between items-start gap-6 border-b border-slate-50 pb-8">
                                    <h4 className="text-xl font-bold text-slate-800 leading-snug flex-1">
                                        <span className="text-teal-500 font-black italic mr-3">Q{index + 1}.</span> {q.questionText}
                                    </h4>
                                    <div className="flex gap-2">
                                        <div className="px-5 py-2 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-100 font-black text-xs uppercase tracking-widest">Tech: {q.technicalScore}%</div>
                                        <div className="px-5 py-2 rounded-2xl bg-blue-50 text-blue-700 border border-blue-100 font-black text-xs uppercase tracking-widest">Comm: {q.confidenceScore}%</div>
                                    </div>
                                </div>

                                {/* Comparison Grid */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                                    <div className="space-y-3">
                                        <label className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] block ml-2 text-center">Your Response</label>
                                        <div className="bg-slate-50 rounded-[2.5rem] p-8 border border-slate-100 min-h-[150px] space-y-4">
                                            {q.userSubmittedCode && (
                                                <pre className="text-[11px] font-mono text-slate-700 bg-white p-4 rounded-xl border border-slate-200 overflow-x-auto whitespace-pre-wrap">{q.userSubmittedCode}</pre>
                                            )}
                                            {q.userAnswerText && <p className="text-xs text-slate-600 leading-relaxed italic">"{q.userAnswerText}"</p>}
                                            {!q.userAnswerText && !q.userSubmittedCode && <p className="text-slate-400 italic text-xs text-center">No record.</p>}
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <label className="text-[10px] font-black text-teal-600 uppercase tracking-[0.3em] block ml-2 text-center">AI Ideal Answer</label>
                                        <div className="bg-slate-900 text-slate-400 rounded-[2.5rem] p-8 min-h-[150px] shadow-inner font-mono text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap flex items-center">
                                            {formatIdealAnswer(q.idealAnswer)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* INTEGRITY STATUS BOX (Redundant Dashboard button removed) */}
            <div className={`p-10 rounded-[3.5rem] border ${violations > 0 ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'} text-center`}>
                <h4 className={`text-2xl font-black uppercase tracking-tighter mb-4 ${violations > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {violations > 0 ? 'Security Incident Logged' : 'Integrity Verified'}
                </h4>
                <p className={`text-sm leading-relaxed max-w-3xl mx-auto ${violations > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {violations > 0 
                      ? `Our AI Proctor detected ${violations} instances of misbehavior, including tab switches or unauthorized object detection (cell phone / face loss). These events have been factored into your final "Integrity Score" and have influenced your overall selection probability.`
                      : 'Zero behavioral anomalies detected. Candidate maintained full compliance with professional proctoring standards during the entire session.'
                    }
                </p>
                <div className="mt-8 flex justify-center gap-6">
                    <div className="px-6 py-2 bg-white rounded-full border border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">Tab Switches: Logged</div>
                    <div className="px-6 py-2 bg-white rounded-full border border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">Phone Detection: Active</div>
                    <div className="px-6 py-2 bg-white rounded-full border border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">Face Loss: Monitored</div>
                </div>
            </div>

        </div>
    );
}

export default SessionReview;