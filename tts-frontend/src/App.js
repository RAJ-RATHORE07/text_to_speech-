// src/App.js
import React, { useRef, useState, useEffect } from "react";
import axios from "axios";
import "./App.css";

axios.defaults.baseURL = process.env.REACT_APP_API_BASE || "http://localhost:5000";

// helper to set axios default header if token exists (single definition)
function setAuthToken(token) {
  if (token) axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  else delete axios.defaults.headers.common["Authorization"];
}

function NavBar({ user, onOpenAuth, onLogout, active, setActive }) {
  return (
    <nav className="site-nav">
      <div className="nav-left">
        <div className="brand" onClick={() => setActive('home')}>🗣️ TTS Studio</div>
        <div className="nav-links">
          <button className={active==='home'?'active':''} onClick={() => setActive('home')}>Home</button>
          <button className={active==='saved'?'active':''} onClick={() => setActive('saved')}>Saved</button>
          <button className={active==='history'?'active':''} onClick={() => setActive('history')}>History</button>
        </div>
      </div>

      <div className="nav-right">
        {user ? (
          <>
            <div className="user-pill">{user.email}</div>
            <button className="logout-btn" onClick={onLogout}>Logout</button>
          </>
        ) : (
          <>
            <button onClick={() => onOpenAuth('login')}>Login</button>
            <button className="primary" onClick={() => onOpenAuth('signup')}>Sign up</button>
          </>
        )}
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div>© {new Date().getFullYear()} TTS Studio — Built with ♥</div>
      <div className="small">Auth backed by the Flask server (simple JWT). For demo only.</div>
    </footer>
  );
}

function AuthModal({ mode, onClose, onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  useEffect(()=>{ setEmail(""); setPassword(""); setName(""); },[mode]);

  const doSignup = async () => {
    if(!email || !password) return alert("Provide email and password");
    try {
      const r = await axios.post("/api/register", { email, password, name });
      if (r.data && r.data.ok) {
        localStorage.setItem("tts_token", r.data.token);
        setAuthToken(r.data.token);
        onLogin(r.data.user);
        onClose();
      } else {
        alert("Signup failed: " + JSON.stringify(r.data));
      }
    } catch (e) {
      alert("Signup failed: " + (e?.response?.data?.error || e.message));
    }
  };

  const doLogin = async () => {
    if(!email || !password) return alert("Provide email and password");
    try {
      const r = await axios.post("/api/login", { email, password });
      if (r.data && r.data.ok) {
        localStorage.setItem("tts_token", r.data.token);
        setAuthToken(r.data.token);
        onLogin(r.data.user);
        onClose();
      } else {
        alert("Login failed: " + JSON.stringify(r.data));
      }
    } catch (e) {
      alert("Login failed: " + (e?.response?.data?.error || e.message));
    }
  };

  return (
    <div className="auth-modal-backdrop">
      <div className="auth-modal card">
        <div className="auth-head">{mode==='signup' ? 'Create an account' : 'Log in to your account'}</div>
        {mode==='signup' && (<input placeholder="Full name (optional)" value={name} onChange={e=>setName(e.target.value)} />)}
        <input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />

        <div style={{display:'flex',gap:8,marginTop:12}}>
          {mode==='signup' ? (
            <button className="primary" onClick={doSignup}>Create account</button>
          ) : (
            <button className="primary" onClick={doLogin}>Login</button>
          )}
          <button onClick={onClose}>Cancel</button>
        </div>
        <div style={{marginTop:10,fontSize:13,color:'#666'}}>Credentials are stored on the demo server (file-based users.json).</div>
      </div>
    </div>
  );
}

export default function App() {
  // TTS & UI state
  const [voicesList, setVoicesList] = useState([]);
  const [flatVoices, setFlatVoices] = useState([]);
  const [text, setText] = useState("");
  const textareaRef = useRef(null);
  const [voice, setVoice] = useState("");
  const [audioSrc, setAudioSrc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detectedLang, setDetectedLang] = useState("");
  const [history, setHistory] = useState([]);
  const [pitch, setPitch] = useState("0");
  const [rate, setRate] = useState("1.0");
  const [volume, setVolume] = useState("1.0");
 const [autoPlay] = useState(true);
  const [duration, setDuration] = useState(0);

  const [languageFilter, setLanguageFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [showMore] = useState(false);

  const [sampleAudioSrc, setSampleAudioSrc] = useState(null);
  const [sampleLoadingId, setSampleLoadingId] = useState(null);
  const [showSamplesPanel, setShowSamplesPanel] = useState(false);
  const [savedList, setSavedList] = useState([]);

  // nav & auth
  const [active, setActive] = useState('home');
  const [authOpenMode, setAuthOpenMode] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const init = async () => {
      try {
        const resp = await axios.get("/api/voices");
        const groups = resp.data || [];
        console.log("Fetched voices:", groups);
        setVoicesList(groups);
        const flat = groups.flatMap((g) =>
          (g.voices || []).map((v) => ({ ...v, langGroup: g.lang, langCode: g.code }))
        );
        setFlatVoices(flat);

        // auto-select first language/gender/voice so dropdowns show up
        if (groups.length > 0) {
          const firstLang = groups[0].lang || "";
          setLanguageFilter(prev => prev || firstLang);

          const firstVoices = groups[0].voices || [];
          if (firstVoices.length > 0) {
            const femaleExists = firstVoices.some(v => (v.gender || "").toLowerCase() === "female");
            const maleExists = firstVoices.some(v => (v.gender || "").toLowerCase() === "male");
            setGenderFilter(prev => prev || (femaleExists ? "female" : maleExists ? "male" : "all"));

            const chosenGender = femaleExists ? "female" : maleExists ? "male" : null;
            const chosenVoice = chosenGender ?
              firstVoices.find(v => (v.gender || "").toLowerCase() === chosenGender) :
              firstVoices[0];
            if (chosenVoice) setVoice(prev => prev || chosenVoice.value);
          }
        }
      } catch (err) {
        console.error("Failed to fetch voices:", err);
      }
    };
    init();

    fetchSaved();
    const saved = localStorage.getItem("tts_history_v2");
    if (saved) setHistory(JSON.parse(saved));

    // restore token & user
    const token = localStorage.getItem("tts_token");
    if (token) {
      setAuthToken(token);
      axios.get("/api/me").then(r => {
        if (r.data && r.data.ok) setUser(r.data.user);
      }).catch(()=>{});
    }
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    localStorage.setItem("tts_history_v2", JSON.stringify(history));
  }, [history]);

  const fetchSaved = async () => {
    try {
      const r = await axios.get("/api/history");
      setSavedList(r.data || []);
    } catch (e) {
      console.error("load saved err", e);
    }
  };

  const getSelectedOrAllText = () => {
    const ta = textareaRef.current;
    if (!ta) return text.trim();
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (typeof start === "number" && typeof end === "number" && end > start) {
      const sel = ta.value.slice(start, end).trim();
      if (sel.length > 0) return sel;
    }
    return text.trim();
  };

  const buildVoicesForRender = () => {
    if (!languageFilter || !genderFilter) return [];
    const lang = languageFilter;
    const gender = String(genderFilter || "").toLowerCase();

    const results = (voicesList || [])
      .filter((g) => (g.lang || "").trim() === (lang || "").trim())
      .map((g) => {
        const filtered = (g.voices || []).filter((v) => {
          const vg = (v.gender || "").toLowerCase();
          if (gender === "all") return true;
          return vg && vg === gender;
        });
        return { ...g, voices: showMore ? filtered : filtered.slice(0, 50) };
      })
      .filter((g) => (g.voices || []).length > 0);

    return results;
  };

  const renderedVoices = buildVoicesForRender();
  const languageOptions = Array.from(new Set((voicesList || []).map((g) => g.lang))).filter(Boolean);
  const isReadyToSpeak = Boolean(languageFilter && genderFilter && voice);

  const sampleTextForVoice = (voiceObj) => {
    if (voiceObj && voiceObj.langGroup) return `Sample of ${voiceObj.label} (${voiceObj.langGroup}).`;
    return "This is a voice sample.";
  };

  const handlePlaySample = async (voiceValue) => {
    if (!voiceValue) return;
    const vobj = flatVoices.find((v) => v.value === voiceValue) || {};
    const sample = sampleTextForVoice(vobj);
    try {
      setSampleLoadingId(voiceValue);
      const resp = await axios.post("/api/speak", { text: sample, voice: voiceValue, pitch: "0", rate: "1.0", volume: "1.0", tone: "none" }, { responseType: "blob" });
      const blob = resp.data;
      if (!blob || blob.size === 0) throw new Error("Empty sample audio");
      if (sampleAudioSrc) try { URL.revokeObjectURL(sampleAudioSrc); } catch {}
      const url = URL.createObjectURL(blob);
      setSampleAudioSrc(url);
      setTimeout(()=> {
        const el = document.getElementById("sample-audio");
        if (el) el.play().catch(()=>{});
      }, 60);
    } catch (e) {
      alert("Sample failed: " + (e?.response?.data?.error || e.message));
    } finally {
      setSampleLoadingId(null);
    }
  };

  const handlePlayCurrentSample = () => {
    if (!voice) return alert("Please select a voice to sample.");
    handlePlaySample(voice);
  };

  const handleSpeak = async ({enhance=false} = {}) => {
    const toSpeak = getSelectedOrAllText();
    if (!toSpeak) return alert("Please type text or select text.");
    setLoading(true);
    setAudioSrc(null);
    setDetectedLang("");
    try {
      const resp = await axios.post("/api/speak", { text: toSpeak, voice, pitch, rate, volume, tone: "none", enhance }, { responseType: "blob" });
      const blob = resp.data;
      if (!blob || blob.size === 0) throw new Error("Empty audio data");
      const url = URL.createObjectURL(new Blob([blob]));
      setAudioSrc(url);
      const vmeta = flatVoices.find(v=>v.value===voice) || {};
      const entry = { text: toSpeak, voiceLabel: vmeta.label || voice, voiceValue: voice, createdAt: Date.now(), blobUrl: url };
      setHistory(prev => [entry, ...prev].slice(0,20));
      const detectedHeader = resp.headers["x-detected-lang"];
      if (detectedHeader) setDetectedLang(detectedHeader.toUpperCase());
    } catch (err) {
      const serverData = err?.response?.data;
      let msg = err.message;
      if (serverData) {
        if (serverData.error) msg = serverData.error;
        if (serverData.attempts) msg += "\nAttempts:\n" + serverData.attempts.map((a,i)=>`${i+1}. ${a.voice} - ${a.error || (a.ok?"ok":"failed")}`).join("\n");
      }
      alert("Speech generation failed.\n" + msg);
    } finally {
      setLoading(false);
    }
  };

  const handleAudioLoaded = (e) => {
    if (e?.target?.duration) setDuration(Number(e.target.duration).toFixed(2));
  };

  const playHistoryEntry = (h) => {
    if (!h || !h.blobUrl) return;
    setAudioSrc(h.blobUrl);
    setTimeout(()=> {
      const a = document.querySelector(".right-audio audio");
      if (a) a.play().catch(()=>{});
    }, 60);
  };

  const uploadBlobToServer = async (entry) => {
    if (!entry || !entry.blobUrl) return alert("No audio blob to upload.");
    try {
      if (!localStorage.getItem("tts_token")) return alert("Please login to save files.");
      const r = await fetch(entry.blobUrl);
      const blob = await r.blob();
      const fd = new FormData();
      const fname = `tts_${Date.now()}.mp3`;
      fd.append("file", blob, fname);
      fd.append("title", entry.text ? (entry.text.slice(0,60) + (entry.text.length>60 ? "..." : "")) : fname);
      fd.append("tags", "generated,tts");
      const resp = await axios.post("/api/upload", fd, { headers: { "Content-Type": "multipart/form-data" }});
      if (resp.data && resp.data.ok) {
        alert("Uploaded to server: " + (resp.data.meta.title || resp.data.meta.filename));
        fetchSaved();
      } else {
        alert("Upload failed: " + JSON.stringify(resp.data));
      }
    } catch (e) {
      alert("Upload failed: " + (e?.response?.data?.error || e.message));
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "text/plain") return alert("Please upload a .txt file.");
    const reader = new FileReader();
    reader.onload = () => setText(reader.result);
    reader.readAsText(file);
  };

  const handleClear = () => {
    setText("");
    setAudioSrc(null);
    setSampleAudioSrc(null);
    setDetectedLang("");
    setPitch("0");
    setRate("1.0");
    setVolume("1.0");
    setHistory([]);
    setLanguageFilter("");
    setGenderFilter("");
    setVoice("");
    setDuration(0);
  };

  const hasVoicesForGenderInLanguage = () => {
    if (!languageFilter) return false;
    const langBlock = (voicesList || []).find((g) => g.lang === languageFilter);
    if (!langBlock) return false;
    if (!genderFilter || genderFilter === "all") return (langBlock.voices || []).length > 0;
    const lower = (genderFilter || "").toLowerCase();
    return (langBlock.voices || []).some((v) => (v.gender || "").toLowerCase() === lower);
  };

  const visibleFlatVoices = renderedVoices.flatMap((g) => (g.voices || []).map((v) => ({ ...v, lang: g.lang })));

  const openAuth = (mode) => setAuthOpenMode(mode);
  const closeAuth = () => setAuthOpenMode(null);
  const handleLogin = (u) => {
    setUser(u);
    setAuthToken(localStorage.getItem("tts_token"));
  };
  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("tts_token");
    setAuthToken(null);
  };

  return (
    <div className="page-root">
      <NavBar user={user} onOpenAuth={openAuth} onLogout={handleLogout} active={active} setActive={setActive} />

      <main className="page-main">
        {active === 'home' && (
          <div className="root-wrap">
            <div className="app-card">
              <header className="app-header">
                <h1 className="title">Multilingual TTS — Save & Validate</h1>
                <div className="subtitle">Generate → Save to server → Manage saved files</div>
              </header>

              <div className="main-grid">
                <section className="left-col">
                  <label className="file-row"><input type="file" accept=".txt" onChange={handleFileUpload} /></label>
                  <textarea ref={textareaRef} className="text-area" value={text} onChange={e=>setText(e.target.value)} placeholder="Type or paste text..." />

                  <div className="controls">
                    <div className="control-row">
                      <div className="control-label">Language</div>
                      <select value={languageFilter} onChange={(e)=>setLanguageFilter(e.target.value)}>
                        <option value="">-- Select language --</option>
                        {languageOptions.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>

                    <div className="control-row">
                      <div className="control-label">Gender</div>
                      <select value={genderFilter} onChange={(e)=>setGenderFilter(e.target.value)}>
                        <option value="">-- Select gender --</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="all">All</option>
                      </select>
                    </div>

                    {!hasVoicesForGenderInLanguage() && languageFilter && genderFilter && (
                      <div className="warning">No <strong>{genderFilter}</strong> voices for <strong>{languageFilter}</strong>. <button className="secondary" onClick={()=>setGenderFilter("all")}>Show all voices</button></div>
                    )}

                    <div className="control-row">
                      <div className="control-label">Voice</div>
                      <select value={voice} onChange={(e)=>setVoice(e.target.value)} disabled={!languageFilter || !genderFilter || renderedVoices.length===0}>
                        {!languageFilter || !genderFilter ? <option value="">Choose language & gender</option> :
                          renderedVoices.length===0 ? <option value="">No voices available</option> :
                            renderedVoices.map((g,gi)=> (<optgroup key={gi} label={g.lang}>
                              {g.voices.map(v=> <option key={v.value} value={v.value}>{v.label} {v.gender ? `(${v.gender})` : ""}</option>)}
                            </optgroup>))
                        }
                      </select>
                    </div>

                    <div className="control-row">
                      <div className="control-label">Sample</div>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <button onClick={handlePlayCurrentSample} disabled={!voice || !!sampleLoadingId}>
                          {sampleLoadingId === voice ? "Loading..." : "Play sample"}
                        </button>
                        <button onClick={()=>setShowSamplesPanel(s=>!s)} disabled={!languageFilter || !genderFilter}>
                          {showSamplesPanel ? "Hide samples" : "Sample visible voices"}
                        </button>
                      </div>
                    </div>

                    <div className="slider-wrap">
                      <div className="slider-row"><label>Pitch</label>
                        <input type="range" min="-2" max="2" step="0.1" value={pitch} onChange={e=>setPitch(e.target.value)} />
                        <span>{pitch}</span>
                      </div>
                      <div className="slider-row"><label>Rate</label>
                        <input type="range" min="0.5" max="2" step="0.1" value={rate} onChange={e=>setRate(e.target.value)} />
                        <span>{rate}</span>
                      </div>
                      <div className="slider-row"><label>Volume</label>
                        <input type="range" min="0" max="1.5" step="0.1" value={volume} onChange={e=>setVolume(e.target.value)} />
                        <span>{volume}</span>
                      </div>
                    </div>

                    <div className="buttons-row">
                      <button onClick={()=>handleSpeak({enhance:false})} disabled={!isReadyToSpeak || loading}>{loading ? "Generating..." : "Speak"}</button>
                      <button onClick={()=>handleSpeak({enhance:true})} disabled={!isReadyToSpeak || loading}>Speak (Enhance)</button>
                      <button onClick={handleClear}>Clear</button>
                    </div>

                    {detectedLang && <div className="detected">Detected: <strong>{detectedLang}</strong></div>}
                  </div>

                  {showSamplesPanel && (
                    <div className="samples-panel card" style={{marginTop:12}}>
                      <div style={{fontWeight:600,marginBottom:8}}>Visible voices — click play</div>
                      {visibleFlatVoices.length===0 ? <div>No voices visible</div> : (
                        <div style={{display:"grid",gap:6}}>
                          {visibleFlatVoices.map(v=>(
                            <div key={v.value} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                              <div><div style={{fontSize:13}}>{v.label} {v.gender ? `(${v.gender})` : ""}</div><div style={{fontSize:11,color:"#666"}}>{v.lang}</div></div>
                              <div><button onClick={()=>handlePlaySample(v.value)} disabled={!!sampleLoadingId}>{sampleLoadingId===v.value ? "Loading..." : "Play"}</button></div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <aside className="right-col">
                  <div className="right-audio card">
                    <div className="audio-header">Preview</div>
                    {audioSrc ? (
                      <>
                        <audio controls src={audioSrc} autoPlay={autoPlay} onLoadedMetadata={handleAudioLoaded} />
                        <div className="audio-meta">
                          {duration>0 && <span>Duration: {duration}s</span>}
                          <a href={audioSrc} download={`speech_${Date.now()}.mp3`}>Download</a>
                        </div>
                      </>
                    ) : <div className="empty-audio">No audio yet — generate speech to preview.</div>}

                    <audio id="sample-audio" controls src={sampleAudioSrc || undefined} style={{marginTop:10,width:"100%"}} />
                  </div>

                  <div className="history card" style={{marginTop:12}}>
                    <div className="audio-header">Session History</div>
                    {history.length===0 ? <div>No session history</div> : (
                      <ul>
                        {history.map((h,i)=>(
                          <li key={i}>
                            <div style={{maxWidth: "66%"}}><strong>{h.voiceLabel}</strong><div style={{fontSize:13}}>{h.text.length>80 ? h.text.slice(0,80)+"..." : h.text}</div></div>
                            <div style={{display:"flex",gap:8}}>
                              <button onClick={()=>playHistoryEntry(h)}>Play</button>
                              <button onClick={()=>uploadBlobToServer(h)}>Save</button>
                              <a href={h.blobUrl} download={`history_${i}.mp3`}>⬇</a>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="history card" style={{marginTop:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div className="audio-header">Saved Files (server)</div>
                      <div><button onClick={fetchSaved}>Refresh</button></div>
                    </div>
                    {savedList.length===0 ? <div style={{padding:8}}>No saved files</div> : (
                      <ul>
                        {savedList.map(s=>(
                          <li key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div><strong>{s.title}</strong><div className="small">{s.tags && s.tags.join(", ")}</div></div>
                            <div><a href={s.public_url || s.file} target="_blank" rel="noreferrer">Download</a></div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </aside>
              </div>
            </div>
          </div>
        )}

        {active === 'saved' && (
          <div className="center-card card">
            <h2>Saved files</h2>
            <button onClick={fetchSaved}>Refresh</button>
            <ul>
              {savedList.map(s=> <li key={s.id}><strong>{s.title}</strong> — <a href={s.public_url || s.file} target="_blank" rel="noreferrer">Download</a></li>)}
            </ul>
          </div>
        )}

        {active === 'history' && (
          <div className="center-card card">
            <h2>Session history</h2>
            {history.length===0 ? <div>No history yet</div> : (
              <ul>
                {history.map((h,i)=> <li key={i}><strong>{h.voiceLabel}</strong> — {h.text.slice(0,80)}...</li>)}
              </ul>
            )}
          </div>
        )}
      </main>

      <Footer />

      {authOpenMode && <AuthModal mode={authOpenMode} onClose={closeAuth} onLogin={handleLogin} />}
    </div>
  );
}
