
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Clock, Trash2, Bell, BellOff, Volume2, Sparkles, Pencil, X, Copy, Bookmark, AlertTriangle, Hourglass, Timer, Zap, GripVertical, Upload, RefreshCcw, Play, Square, User, LogOut, ChevronRight } from 'lucide-react';
import { SchoolClass, AlarmState } from './types';
import { GoogleGenAI } from "@google/genai";

// Standard Audio for the alarm
const DEFAULT_ALARM_SOUND = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

const DAYS_OF_WEEK = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

// Web Worker code as a string to be run in the background
const workerCode = `
  let timer = null;
  self.onmessage = function(e) {
    if (e.data === 'start') {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        self.postMessage('tick');
      }, 1000);
    } else if (e.data === 'stop') {
      clearInterval(timer);
    }
  };
`;

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [userInput, setUserInput] = useState('');
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [classToDelete, setClassToDelete] = useState<string | null>(null);
  const [customAlarmSound, setCustomAlarmSound] = useState<string | null>(null);
  const [customSoundName, setCustomSoundName] = useState<string | null>(null);
  const [isTestingSound, setIsTestingSound] = useState(false);
  const [isAudioUnlocked, setIsAudioUnlocked] = useState(false);
  
  // Track already fired alarms for the current minute to prevent double firing
  const firedAlarmsRef = useRef<Set<string>>(new Set());
  const lastMinuteRef = useRef<number>(-1);

  // Drag and Drop Refs
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // Form States
  const [newClassName, setNewClassName] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  
  const [activeAlarm, setActiveAlarm] = useState<AlarmState | null>(null);
  const [motivation, setMotivation] = useState<string>('');
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoStopTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  // Function to unlock audio (must be called from a user gesture)
  const unlockAudio = useCallback(() => {
    if (audioRef.current && !isAudioUnlocked) {
      audioRef.current.play().then(() => {
        audioRef.current?.pause();
        audioRef.current!.currentTime = 0;
        setIsAudioUnlocked(true);
        console.log("Audio system unlocked and ready.");
      }).catch(e => {
        console.log("Audio unlock failed, waiting for next interaction.", e);
      });
    }
  }, [isAudioUnlocked]);

  // Initialize Web Worker and Audio
  useEffect(() => {
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    
    worker.onmessage = () => {
      const now = new Date();
      setCurrentTime(now);
      checkAlarms(now);
    };
    
    worker.postMessage('start');
    workerRef.current = worker;

    // Initialize audio element if not exists
    if (!audioRef.current) {
      audioRef.current = new Audio(DEFAULT_ALARM_SOUND);
      audioRef.current.loop = true;
      audioRef.current.preload = 'auto';
    }

    // Request Notification Permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    return () => {
      worker.postMessage('stop');
      worker.terminate();
    };
  }, [classes, currentUser]);

  // Setup Media Session API
  useEffect(() => {
    if ('mediaSession' in navigator && currentUser) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'منبه الحصص المدرسية',
        artist: currentUser,
        album: 'الجدول الدراسي الذكي',
        artwork: [
          { src: 'https://cdn-icons-png.flaticon.com/512/3602/3602145.png', sizes: '512x512', type: 'image/png' }
        ]
      });

      navigator.mediaSession.setActionHandler('stop', () => stopAlarm());
    }
  }, [currentUser]);

  // Load user on start
  useEffect(() => {
    const savedUser = localStorage.getItem('last_active_user');
    if (savedUser) {
      setCurrentUser(savedUser);
    }
  }, []);

  // Initialize data when user changes
  useEffect(() => {
    if (!currentUser) {
      setClasses([]);
      setCustomAlarmSound(null);
      setCustomSoundName(null);
      return;
    }

    const userKey = `user_${currentUser}_`;
    const savedClasses = localStorage.getItem(`${userKey}classes`);
    if (savedClasses) {
      try {
        setClasses(JSON.parse(savedClasses));
      } catch (e) {
        console.error("Failed to parse saved classes", e);
      }
    } else {
      setClasses([]);
    }

    const savedSound = localStorage.getItem(`${userKey}custom_alarm_sound`);
    const savedSoundName = localStorage.getItem(`${userKey}custom_alarm_sound_name`);
    if (savedSound) {
      setCustomAlarmSound(savedSound);
      setCustomSoundName(savedSoundName);
    } else {
      setCustomAlarmSound(null);
      setCustomSoundName(null);
    }

    if (audioRef.current) {
      audioRef.current.src = savedSound || DEFAULT_ALARM_SOUND;
      audioRef.current.load();
    }
    
    fetchMotivation();
  }, [currentUser]);

  // Save to localStorage
  useEffect(() => {
    if (!currentUser) return;
    const userKey = `user_${currentUser}_`;
    localStorage.setItem(`${userKey}classes`, JSON.stringify(classes));
  }, [classes, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const userKey = `user_${currentUser}_`;
    if (customAlarmSound) {
      localStorage.setItem(`${userKey}custom_alarm_sound`, customAlarmSound);
      localStorage.setItem(`${userKey}custom_alarm_sound_name`, customSoundName || '');
    } else {
      localStorage.removeItem(`${userKey}custom_alarm_sound`);
      localStorage.removeItem(`${userKey}custom_alarm_sound_name`);
    }
    if (audioRef.current) {
      audioRef.current.src = customAlarmSound || DEFAULT_ALARM_SOUND;
      audioRef.current.load();
    }
  }, [customAlarmSound, customSoundName, currentUser]);

  const currentOngoingClass = useMemo(() => {
    const dayName = DAYS_OF_WEEK[currentTime.getDay()];
    const nowStr = currentTime.getHours().toString().padStart(2, '0') + ':' + currentTime.getMinutes().toString().padStart(2, '0');
    
    return classes.find(c => {
      if (!c.active || !c.days.includes(dayName)) return false;
      return nowStr >= c.startTime && nowStr < c.endTime;
    });
  }, [classes, currentTime]);

  const classProgress = useMemo(() => {
    if (!currentOngoingClass) return null;

    const [startH, startM] = currentOngoingClass.startTime.split(':').map(Number);
    const [endH, endM] = currentOngoingClass.endTime.split(':').map(Number);

    const startDate = new Date(currentTime);
    startDate.setHours(startH, startM, 0, 0);

    const endDate = new Date(currentTime);
    endDate.setHours(endH, endM, 0, 0);

    const totalDuration = endDate.getTime() - startDate.getTime();
    const elapsed = currentTime.getTime() - startDate.getTime();

    if (totalDuration <= 0) return 0;
    const percentage = (elapsed / totalDuration) * 100;
    return Math.min(Math.max(percentage, 0), 100);
  }, [currentOngoingClass, currentTime]);

  const remainingTime = useMemo(() => {
    if (!currentOngoingClass) return null;
    const [h, m] = currentOngoingClass.endTime.split(':').map(Number);
    const end = new Date(currentTime);
    end.setHours(h, m, 0, 0);
    
    const diff = end.getTime() - currentTime.getTime();
    if (diff <= 0) return null;

    const totalSeconds = Math.floor(diff / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    return { minutes, seconds };
  }, [currentOngoingClass, currentTime]);

  const fetchMotivation = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: "أعطني نصيحة دراسية قصيرة وملهمة للطلاب باللغة العربية. اجعلها جملة واحدة فقط.",
        config: { temperature: 0.7 }
      });
      setMotivation(response.text || 'العلم نور والجهل ظلام!');
    } catch (error) {
      setMotivation('بالتوفيق في يومك الدراسي!');
    }
  };

  const checkAlarms = (now: Date) => {
    if (!currentUser || activeAlarm) return;

    const currentMinute = now.getMinutes();
    const currentHour = now.getHours();
    const dayName = DAYS_OF_WEEK[now.getDay()];
    const timeStr = currentHour.toString().padStart(2, '0') + ':' + currentMinute.toString().padStart(2, '0');

    if (currentMinute !== lastMinuteRef.current) {
      firedAlarmsRef.current.clear();
      lastMinuteRef.current = currentMinute;
    }

    classes.forEach(c => {
      if (!c.active || !c.days.includes(dayName)) return;

      if (timeStr === c.endTime && !firedAlarmsRef.current.has(c.id)) {
        firedAlarmsRef.current.add(c.id);
        triggerAlarm(c.name, 'end');
        
        if (Notification.permission === "granted") {
          new Notification(`انتهت حصة ${c.name}`, {
            body: "حان موعد الراحة أو الحصة التالية!",
            icon: "https://cdn-icons-png.flaticon.com/512/3602/3602145.png",
            tag: 'class-alarm',
            requireInteraction: true
          });
        }
      }
    });
  };

  const triggerAlarm = (className: string, type: 'start' | 'end') => {
    setActiveAlarm({ isActive: true, className, type });
    
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      const playPromise = audioRef.current.play();
      
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.error("Autoplay prevented sound. User needs to interact with the page.", error);
          setIsAudioUnlocked(false);
        });
      }
    }

    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    autoStopTimerRef.current = window.setTimeout(() => {
      stopAlarm();
    }, 20000); 
  };

  const stopAlarm = () => {
    setActiveAlarm(null);
    setIsTestingSound(false);
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (userInput.trim()) {
      const trimmedUser = userInput.trim();
      setCurrentUser(trimmedUser);
      localStorage.setItem('last_active_user', trimmedUser);
      
      // Critical: Unlock audio on login click
      unlockAudio();
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('last_active_user');
    stopAlarm();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert("الملف كبير جداً. يرجى اختيار ملف أصغر من 2 ميجابايت.");
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setCustomAlarmSound(base64);
        setCustomSoundName(file.name);
      };
      reader.readAsDataURL(file);
    }
  };

  const resetToDefaultSound = () => {
    setCustomAlarmSound(null);
    setCustomSoundName(null);
  };

  const toggleTestSound = () => {
    unlockAudio(); // Try to unlock if not already
    if (isTestingSound) {
      stopAlarm();
    } else {
      setIsTestingSound(true);
      triggerAlarm("تجربة الجرس", 'start');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio(); // Ensure audio is ready
    if (!newClassName || !startTime || !endTime || selectedDays.length === 0) return;

    if (editingClassId) {
      setClasses(prev => prev.map(c => 
        c.id === editingClassId 
          ? { ...c, name: newClassName, startTime, endTime, days: selectedDays }
          : c
      ));
    } else {
      const newClass: SchoolClass = {
        id: Date.now().toString(),
        name: newClassName,
        startTime,
        endTime,
        days: selectedDays,
        active: true
      };
      setClasses(prev => [...prev, newClass]);
    }
    
    resetForm();
  };

  const handleDragStart = (index: number) => {
    dragItem.current = index;
  };

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index;
  };

  const handleDragEnd = () => {
    if (dragItem.current !== null && dragOverItem.current !== null) {
      const copyClasses = [...classes];
      const dragItemContent = copyClasses[dragItem.current];
      copyClasses.splice(dragItem.current, 1);
      copyClasses.splice(dragOverItem.current, 0, dragItemContent);
      dragItem.current = null;
      dragOverItem.current = null;
      setClasses(copyClasses);
    }
  };

  const handleEdit = (schoolClass: SchoolClass) => {
    setEditingClassId(schoolClass.id);
    setNewClassName(schoolClass.name);
    setStartTime(schoolClass.startTime);
    setEndTime(schoolClass.endTime);
    setSelectedDays(schoolClass.days);
    setIsFormOpen(true);
  };

  const handleDuplicate = (schoolClass: SchoolClass) => {
    setEditingClassId(null);
    setNewClassName(`${schoolClass.name} (نسخة)`);
    setStartTime(schoolClass.startTime);
    setEndTime(schoolClass.endTime);
    setSelectedDays(schoolClass.days);
    setIsFormOpen(true);
  };

  const resetForm = () => {
    setNewClassName('');
    setStartTime('');
    setEndTime('');
    setSelectedDays([]);
    setEditingClassId(null);
    setIsFormOpen(false);
  };

  const toggleDay = (day: string) => {
    setSelectedDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const confirmDelete = () => {
    if (classToDelete) {
      setClasses(prev => prev.filter(c => c.id !== classToDelete));
      setClassToDelete(null);
    }
  };

  const toggleClassActive = (id: string) => {
    setClasses(prev => prev.map(c => c.id === id ? { ...c, active: !c.active } : c));
  };

  // Login View
  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-100 via-white to-slate-50">
        <div className="w-full max-w-md animate-in fade-in zoom-in duration-500">
          <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 border border-blue-50 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full -mr-16 -mt-16 opacity-50"></div>
            
            <div className="text-center relative">
              <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-200 transform -rotate-6">
                <Clock size={40} className="text-white" />
              </div>
              <h1 className="text-3xl font-black text-slate-800 mb-2">مرحباً بك مجدداً</h1>
              <p className="text-slate-400 font-medium mb-10">أدخل اسمك للوصول إلى جدولك الخاص</p>
              
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="relative group">
                  <User size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                  <input 
                    type="text"
                    required
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="اسم المستخدم"
                    className="w-full pr-12 pl-4 py-4 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-right font-bold text-slate-700"
                  />
                </div>
                <button 
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl shadow-xl shadow-blue-200 transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 text-lg"
                >
                  دخول النظام
                  <ChevronRight size={22} />
                </button>
              </form>
              
              <div className="mt-10 pt-6 border-t border-slate-50 text-slate-300 text-[10px] font-bold tracking-widest uppercase text-center">
                Smart School Alarm System v2.2
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard View
  return (
    <div className="min-h-screen pb-20 px-4 md:px-8 max-w-4xl mx-auto" onClick={unlockAudio}>
      {/* Top Navbar */}
      <nav className="py-4 flex justify-between items-center border-b border-slate-100 mb-4 sticky top-0 bg-white/80 backdrop-blur-md z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-100">
            <Clock size={20} className="text-white" />
          </div>
          <div className="text-right">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">الجدول الشخصي لـ</div>
            <div className="text-sm font-black text-slate-800">{currentUser}</div>
          </div>
        </div>
        
        <div className="flex gap-2">
          {!isAudioUnlocked && (
            <button 
              onClick={unlockAudio}
              className="bg-amber-50 text-amber-600 px-3 py-1.5 rounded-xl border border-amber-100 text-[10px] font-black flex items-center gap-1 animate-pulse"
            >
              <AlertTriangle size={12} />
              اضغط لتفعيل الصوت
            </button>
          )}
          <button 
            onClick={handleLogout}
            className="bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-500 p-2.5 rounded-xl transition-all border border-transparent hover:border-red-100 active:scale-90"
            title="تسجيل الخروج"
          >
            <LogOut size={20} />
          </button>
        </div>
      </nav>

      {/* Header & Clock */}
      <header className="py-6 text-center">
        <div className="flex flex-col items-center">
          <div className="mb-4 flex flex-col items-center gap-3 min-h-[6rem] w-full max-w-md">
            {currentOngoingClass ? (
              <div className="w-full bg-white rounded-3xl p-5 shadow-lg border border-green-50 animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="flex justify-between items-center mb-3">
                  <div className="bg-green-100 text-green-700 px-4 py-1 rounded-full text-sm font-bold flex items-center gap-2 border border-green-200">
                    <Bookmark size={14} />
                    {currentOngoingClass.name}
                  </div>
                  <div className="text-amber-600 font-bold text-sm flex items-center gap-1.5">
                    <Hourglass size={14} className="animate-spin-slow" />
                    متبقي: {remainingTime?.minutes}د {remainingTime?.seconds}ث
                  </div>
                </div>
                
                <div className="relative w-full h-3 bg-slate-100 rounded-full overflow-hidden mb-1">
                  <div 
                    className="absolute top-0 right-0 h-full bg-gradient-to-l from-green-400 to-emerald-600 transition-all duration-1000 ease-linear rounded-full shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                    style={{ width: `${classProgress}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 font-medium px-1">
                  <span>{currentOngoingClass.endTime}</span>
                  <span>{Math.round(classProgress || 0)}% منقضي</span>
                  <span>{currentOngoingClass.startTime}</span>
                </div>
              </div>
            ) : (
              <div className="text-slate-400 text-sm font-medium flex items-center gap-2 py-4">
                <Timer size={18} className="opacity-50" />
                لا توجد حصة جارية الآن
              </div>
            )}
          </div>

          <div className="bg-white shadow-xl rounded-2xl p-6 inline-block border border-blue-50">
            <div className="text-5xl font-mono font-bold text-blue-600 mb-1">
              {currentTime.toLocaleTimeString('ar-EG', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="text-slate-500 font-medium">
              {DAYS_OF_WEEK[currentTime.getDay()]} - {currentTime.toLocaleDateString('ar-EG')}
            </div>
          </div>
        </div>

        {motivation && (
          <div className="mt-6 bg-blue-50 border border-blue-100 rounded-lg p-3 text-blue-700 flex items-center justify-center gap-2 max-w-md mx-auto animate-in slide-in-from-top duration-500">
            <span className="text-sm font-semibold flex items-center gap-2">
              <Sparkles size={18} />
              {motivation}
            </span>
          </div>
        )}

        {/* Alarm Settings */}
        <div className="mt-8 flex flex-col items-center">
           <div className="bg-white/80 backdrop-blur-md border border-slate-200 rounded-3xl p-4 flex flex-wrap items-center justify-center gap-4 text-xs shadow-sm">
              <div className="flex items-center gap-2 font-bold text-slate-700">
                <Volume2 size={16} className="text-blue-500" />
                صوت المنبه:
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => { unlockAudio(); fileInputRef.current?.click(); }}
                  className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-4 py-2 rounded-xl flex items-center gap-2 transition-all border border-blue-100 font-bold"
                >
                  <Upload size={14} />
                  {customSoundName ? `مخصص: ${customSoundName.substring(0, 12)}${customSoundName.length > 12 ? '...' : ''}` : 'تحميل جرس مخصص'}
                </button>
                
                <button 
                  onClick={toggleTestSound}
                  className={`${isTestingSound ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'} p-2 rounded-xl transition-all border border-transparent`}
                  title={isTestingSound ? "إيقاف التجربة" : "تجربة الصوت"}
                >
                  {isTestingSound ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                </button>

                {customAlarmSound && (
                  <button 
                    onClick={resetToDefaultSound}
                    className="bg-red-50 hover:bg-red-100 text-red-600 p-2 rounded-xl transition-all border border-red-100"
                    title="إعادة التعيين للافتراضي"
                  >
                    <RefreshCcw size={16} />
                  </button>
                )}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  accept="audio/*" 
                  className="hidden" 
                />
              </div>
           </div>
           <p className="text-[10px] text-slate-400 mt-2">يعمل المنبه بدقة في الخلفية مع صوت وإشعار • تأكد من أن هاتفك ليس في وضع الصامت</p>
        </div>
      </header>

      {/* Main Content */}
      <main className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-slate-700">قائمة الحصص</h2>
          <div className="flex gap-2">
            <button 
              onClick={() => { resetForm(); setIsFormOpen(true); unlockAudio(); }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-all shadow-lg hover:shadow-blue-200 active:scale-95"
            >
              <Plus size={20} />
              إضافة حصة جديدة
            </button>
          </div>
        </div>

        <div className="grid gap-4">
          {classes.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-slate-200 text-slate-400">
              <Clock size={48} className="mx-auto mb-3 opacity-20" />
              <p>لا يوجد حصص مضافة حالياً. ابدأ بإضافة حصتك الأولى!</p>
            </div>
          ) : (
            classes.map((c, index) => (
              <div 
                key={c.id} 
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                className={`group bg-white rounded-2xl p-5 shadow-sm border transition-all hover:shadow-md cursor-grab active:cursor-grabbing ${c.active ? 'border-white' : 'opacity-60 bg-slate-50 border-slate-100'} ${currentOngoingClass?.id === c.id ? 'ring-2 ring-green-400 bg-green-50/30' : ''}`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="mt-1 text-slate-300 group-hover:text-slate-400 transition-colors">
                      <GripVertical size={20} />
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-bold text-slate-800 text-right">{c.name}</h3>
                        {currentOngoingClass?.id === c.id && <span className="bg-green-500 text-white text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-black">جاري الآن</span>}
                        {!c.active && <span className="text-[10px] bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full">متوقف</span>}
                      </div>
                      <div className="flex items-center gap-4 text-slate-500 text-sm justify-start">
                        <span className="flex items-center gap-1"><Clock size={14} className="text-blue-500" /> تبدأ: {c.startTime}</span>
                        <span className="flex items-center gap-1"><Clock size={14} className="text-red-500" /> تنتهي: {c.endTime}</span>
                      </div>
                      <div className="flex gap-1 mt-3 justify-start flex-wrap">
                        {DAYS_OF_WEEK.map(day => (
                          <span key={day} className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${c.days.includes(day) ? 'bg-blue-100 text-blue-700 font-bold border border-blue-200' : 'bg-slate-100 text-slate-400'}`}>
                            {day.substring(0, 2)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mr-4">
                    <button 
                      onClick={(e) => { e.stopPropagation(); toggleClassActive(c.id); unlockAudio(); }}
                      className={`p-2 rounded-full transition-all ${c.active ? 'bg-green-100 text-green-600 hover:bg-green-200' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}
                      title={c.active ? "إيقاف المنبه" : "تفعيل المنبه"}
                    >
                      {c.active ? <Bell size={18} /> : <BellOff size={18} />}
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleEdit(c); }}
                      className="p-2 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all"
                      title="تعديل"
                    >
                      <Pencil size={18} />
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDuplicate(c); }}
                      className="p-2 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all"
                      title="تكرار كحصة جديدة"
                    >
                      <Copy size={18} />
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setClassToDelete(c.id); }}
                      className="p-2 rounded-full bg-red-50 text-red-500 hover:bg-red-100 transition-all"
                      title="حذف"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Add/Edit Class Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in duration-200 relative my-8 text-right">
            <button 
              onClick={resetForm}
              className="absolute top-4 left-4 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X size={24} />
            </button>
            <h2 className="text-2xl font-bold mb-6 text-slate-800">
              {editingClassId ? 'تعديل بيانات الحصة' : 'إضافة حصة جديدة'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1">اسم الحصة (مثلاً: لغة عربية)</label>
                <input 
                  type="text" 
                  required
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-right font-bold"
                  placeholder="أدخل اسم الحصة"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1">وقت البدء</label>
                  <input 
                    type="time" 
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1">وقت الانتهاء</label>
                  <input 
                    type="time" 
                    required
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-2">أيام التكرار</label>
                <div className="flex flex-wrap gap-2 justify-end">
                  {DAYS_OF_WEEK.map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${selectedDays.includes(day) ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button 
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-200 active:scale-95"
                >
                  {editingClassId ? 'حفظ التعديلات' : 'إضافة الحصة'}
                </button>
                <button 
                  type="button"
                  onClick={resetForm}
                  className="px-6 py-3 rounded-xl bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200 transition-all"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {classToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-in fade-in zoom-in duration-200 text-center">
            <div className="bg-red-50 text-red-500 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">تأكيد الحذف</h3>
            <p className="text-slate-500 mb-8 leading-relaxed">
              هل أنت متأكد من رغبتك في حذف هذه الحصة؟
            </p>
            <div className="flex gap-3">
              <button 
                onClick={confirmDelete}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-all active:scale-95 shadow-lg shadow-red-100"
              >
                نعم، احذف
              </button>
              <button 
                onClick={() => setClassToDelete(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3 rounded-xl transition-all"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enhanced Active Alarm UI */}
      {activeAlarm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-blue-600 animate-alarm-pulse"></div>
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent animate-pulse scale-150"></div>
          
          <div className="relative z-10 w-full max-w-lg p-6 text-center animate-in zoom-in fade-in duration-500">
            <div className="mb-8 opacity-90 drop-shadow-2xl">
              <div className="text-6xl font-black text-white font-mono tracking-wider">
                {currentTime.toLocaleTimeString('ar-EG', { hour12: true, hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-white/70 font-semibold text-lg mt-1">الوقت الحالي</div>
            </div>

            <div className="bg-white/10 backdrop-blur-2xl rounded-[3rem] p-10 border border-white/20 shadow-[0_20px_50px_rgba(0,0,0,0.3)] animate-shake">
              <div className="mb-10 relative inline-block">
                <div className="absolute inset-0 bg-white/30 rounded-full animate-ping scale-[2]"></div>
                <div className="bg-white text-blue-600 p-8 rounded-full shadow-2xl relative transform hover:rotate-12 transition-transform">
                  <Volume2 size={80} className="animate-bounce" />
                </div>
              </div>

              <h2 className="text-5xl font-black text-white mb-6 drop-shadow-md">
                انتهت الحصة!
              </h2>

              <div className="space-y-4 mb-12">
                <p className="text-2xl text-white/90 font-medium">حان موعد نهاية حصة</p>
                <div className="text-5xl font-black text-white bg-blue-500/30 py-4 px-8 rounded-2xl inline-block border border-white/20 shadow-inner">
                  {activeAlarm.className}
                </div>
              </div>

              <button 
                onClick={stopAlarm}
                className="group relative bg-white text-blue-700 hover:bg-blue-50 w-full py-6 rounded-3xl text-3xl font-black shadow-2xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-4 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-100/50 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                <BellOff size={32} className="group-hover:rotate-12 transition-transform" />
                إيقاف التنبيه
              </button>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 3s linear infinite;
        }

        @keyframes alarm-pulse {
          0%, 100% { background-color: #2563eb; }
          50% { background-color: #1d4ed8; }
        }
        .animate-alarm-pulse {
          animation: alarm-pulse 2s ease-in-out infinite;
        }

        @keyframes shake {
          0%, 100% { transform: translate(0, 0) rotate(0); }
          10%, 30%, 50%, 70%, 90% { transform: translate(-2px, 0) rotate(-0.5deg); }
          20%, 40%, 60%, 80% { transform: translate(2px, 0) rotate(0.5deg); }
        }
        .animate-shake {
          animation: shake 5s ease-in-out infinite;
        }

        .cursor-grab { cursor: grab; }
        .cursor-grabbing { cursor: grabbing; }
        
        [draggable="true"]:hover {
          border-color: #3b82f6;
        }
      `}} />

      {/* Sticky Bottom Help */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-sm border-t border-slate-100 p-4 text-center text-slate-400 text-xs">
        <p>مرحباً {currentUser} • التنبيه يعمل في الخلفية • اضغط على أي مكان لتأكيد تفعيل قناة الصوت</p>
      </footer>
    </div>
  );
};

export default App;
