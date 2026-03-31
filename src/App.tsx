/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, Component } from 'react';
import { 
  Camera, 
  Upload, 
  CheckCircle2, 
  XCircle, 
  Briefcase, 
  Cpu, 
  Palette, 
  ShieldCheck, 
  ArrowRight, 
  Loader2, 
  ChevronLeft,
  User,
  Zap,
  Sparkles,
  Download,
  RefreshCcw,
  Copy,
  Check,
  Share2,
  QrCode,
  CreditCard,
  AlertCircle,
  Play,
  Video,
  Key,
  LogOut,
  History,
  Settings,
  CreditCard as CardIcon,
  Crown
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  increment, 
  onSnapshot,
  serverTimestamp,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit
} from 'firebase/firestore';
import { auth, db } from './firebase';

// --- Types ---
declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

type Step = 'auth' | 'landing' | 'plans' | 'upload' | 'style' | 'checkout' | 'payment' | 'processing' | 'result' | 'video' | 'user';

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  credits: number;
  plan: 'free' | 'pro' | 'business';
  role: 'user' | 'admin';
  createdAt: any;
}

interface StyleOption {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  image: string;
  prompt: string;
}

interface GeneratedResult {
  title: string;
  narrative: string;
  structured: {
    visual_style: string;
    camera_settings: string;
    lighting: string;
    subject_details: string;
    environment: string;
    script_sync: string;
  };
}

// --- Constants ---
const STYLES: StyleOption[] = [
  {
    id: 'executive',
    title: 'Executivo',
    description: 'Terno e Gravata / Blazer Formal. Ideal para cargos de liderança.',
    icon: <Briefcase className="w-5 h-5" />,
    image: 'https://picsum.photos/seed/executive/400/500',
    prompt: "Professional corporate headshot, high-end navy blue suit, white shirt, silk tie, luxury office background with soft bokeh, Rembrandt lighting, 85mm lens, f/1.8, ultra-realistic skin texture, subsurface scattering, professional studio photography, 8k resolution."
  },
  {
    id: 'casual-tech',
    title: 'Casual Tech',
    description: 'Camiseta básica premium ou polo. Perfeito para startups e tech.',
    icon: <Cpu className="w-5 h-5" />,
    image: 'https://picsum.photos/seed/tech/400/500',
    prompt: "Modern professional portrait, wearing a premium black minimalist t-shirt, high-tech modern office background, natural soft window lighting, 35mm lens, cinematic color grading, realistic skin details, sharp focus on eyes, professional tech industry photography."
  },
  {
    id: 'creative',
    title: 'Criativo',
    description: 'Blazers leves e fundos modernos. Para profissionais de design e artes.',
    icon: <Palette className="w-5 h-5" />,
    image: 'https://picsum.photos/seed/creative/400/500',
    prompt: "Creative professional portrait, stylish light grey blazer, artistic studio background with warm accent lights, soft volumetric lighting, 50mm lens, expressive composition, high fidelity, vibrant but natural colors, professional creative industry photography."
  }
];

const STATUS_MESSAGES = [
  "Analisando traços faciais...",
  "Calculando parâmetros de lente...",
  "Arquitetando iluminação volumétrica...",
  "Estruturando prompt narrativo...",
  "Finalizando engenharia técnica..."
];

// --- AI Service Helpers ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const callWithRetry = async <T,>(fn: () => Promise<T>, maxRetries = 7): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorStr = JSON.stringify(error).toLowerCase();
      const isQuotaError = 
        error?.message?.includes('429') || 
        error?.message?.includes('RESOURCE_EXHAUSTED') ||
        errorStr.includes('429') ||
        errorStr.includes('resource_exhausted') ||
        errorStr.includes('quota');

      if (isQuotaError && i < maxRetries - 1) {
        // Exponential backoff: 3s, 6s, 12s, 24s, 48s, 96s
        const waitTime = Math.pow(2, i) * 3000 + Math.random() * 2000;
        console.warn(`Cota excedida (429). Tentando novamente em ${Math.round(waitTime)}ms... (Tentativa ${i + 1}/${maxRetries})`);
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

// --- AI Service ---
const recommendStyle = async (base64Image: string): Promise<string> => {
  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const base64Data = base64Image.split(',')[1] || base64Image;
    const mimeType = base64Image.split(';')[0].split(':')[1] || 'image/jpeg';

    const prompt = `As a 'Veo 3 Architect' expert, analyze this person's photo. 
    Based on their appearance and current lighting, which of these corporate styles would suit them best?
    1. Executive (Formal, leadership, suits)
    2. Casual Tech (Modern, startup, minimalist)
    3. Creative (Artistic, stylish blazers, modern)
    Return ONLY the ID (executive, casual-tech, or creative).`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          { text: prompt }
        ]
      }
    });
    const text = response.text?.toLowerCase().trim() || 'executive';
    if (text.includes('executive')) return 'executive';
    if (text.includes('tech')) return 'casual-tech';
    if (text.includes('creative')) return 'creative';
    return 'executive';
  });
};

const generateStructuredPrompt = async (base64Image: string, stylePrompt: string): Promise<GeneratedResult> => {
  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const base64Data = base64Image.split(',')[1] || base64Image;
    const mimeType = base64Image.split(';')[0].split(':')[1] || 'image/jpeg';

    const systemInstruction = `Você é o "Veo 3 Architect", um especialista em engenharia de prompts fotorrealistas para o modelo de vídeo Veo 3 da Google. 
    Sua missão é transformar descrições simples em comandos técnicos de altíssima fidelidade.
    
    Para cada pedido, você deve gerar um JSON com:
    1. "title": Um título para o vídeo.
    2. "narrative": Um "Prompt Narrativo" (descrição imersiva em inglês).
    3. "structured": Um objeto contendo:
       - "visual_style": Foco em hiper-realismo e texturas.
       - "camera_settings": Lentes, movimentos e ângulo.
       - "lighting": Descrição física da luz.
       - "subject_details": Pele, cabelo, micro-expressões e roupas.
       - "environment": Detalhes do cenário e profundidade de campo.
       - "script_sync": Caso haja fala, o texto exato e o idioma.`;

    const prompt = `Analise esta foto e o estilo desejado: "${stylePrompt}". 
    Gere um prompt estruturado para um ensaio fotográfico profissional individual que mantenha as características físicas da pessoa mas a coloque no cenário e estilo descritos. 
    Retorne APENAS o JSON.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          { text: prompt }
        ]
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json"
      }
    });

    const result = JSON.parse(response.text || "{}");
    return {
      title: result.title || "Ensaio Profissional Veo 3",
      narrative: result.narrative || "Professional cinematic portrait...",
      structured: {
        visual_style: result.structured?.visual_style || "Hyper-realistic",
        camera_settings: result.structured?.camera_settings || "85mm lens",
        lighting: result.structured?.lighting || "Studio lighting",
        subject_details: result.structured?.subject_details || "Sharp focus",
        environment: result.structured?.environment || "Professional background",
        script_sync: result.structured?.script_sync || "N/A"
      }
    };
  });
};

// --- Components ---

const Header = ({ 
  onBack, 
  showBack, 
  user, 
  credits,
  onUpgrade,
  onUserArea
}: { 
  onBack?: () => void, 
  showBack?: boolean, 
  user?: FirebaseUser | null, 
  credits?: number,
  onUpgrade?: () => void,
  onUserArea?: () => void
}) => (
  <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100 px-4 py-3 flex items-center justify-between">
    <div className="flex items-center gap-2">
      {showBack && (
        <button onClick={onBack} className="p-2 -ml-2 text-slate-600 active:bg-slate-100 rounded-full transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}
      <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => window.location.reload()}>
        <div className="w-8 h-8 bg-navy rounded-lg flex items-center justify-center shadow-md">
          <Zap className="w-5 h-5 text-white fill-white" />
        </div>
        <span className="font-bold text-navy text-lg tracking-tight">CorpShot <span className="text-slate-400 font-medium">Brasil</span></span>
      </div>
    </div>
    <div className="flex items-center gap-3">
      {user && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1 bg-navy/5 rounded-full border border-navy/10">
            <Sparkles className="w-3 h-3 text-navy" />
            <span className="text-xs font-bold text-navy">{credits} Créditos</span>
          </div>
          {credits === 0 && onUpgrade && (
            <button 
              onClick={onUpgrade}
              className="px-3 py-1 bg-navy text-white text-[10px] font-bold rounded-full shadow-lg active:scale-95 transition-all"
            >
              UPGRADE
            </button>
          )}
        </div>
      )}
      <button 
        onClick={onUserArea}
        className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200 active:scale-95 transition-all"
      >
        {user?.photoURL ? (
          <img src={user.photoURL} alt="User" className="w-full h-full object-cover" />
        ) : (
          <User className="w-4 h-4 text-slate-400" />
        )}
      </button>
    </div>
  </header>
);

const AuthStep = ({ onAuth }: { onAuth: (user: FirebaseUser) => void }) => {
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      onAuth(result.user);
    } catch (err) {
      console.error("Erro no login:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-sm w-full"
      >
        <div className="w-20 h-20 bg-navy rounded-3xl flex items-center justify-center shadow-2xl mx-auto mb-8">
          <Zap className="w-10 h-10 text-white fill-white" />
        </div>
        <h1 className="text-3xl font-black text-navy mb-4">Bem-vindo ao CorpShot</h1>
        <p className="text-slate-500 mb-10">
          Crie retratos corporativos de alta fidelidade com IA. 
          <br />
          <span className="text-navy font-bold">Ganhe 3 créditos de bônus ao entrar!</span>
        </p>

        <button 
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full py-4 bg-white border-2 border-slate-100 rounded-2xl flex items-center justify-center gap-3 font-bold text-navy hover:bg-slate-50 active:scale-95 transition-all shadow-sm"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
              Entrar com Google
            </>
          )}
        </button>
      </motion.div>
    </div>
  );
};

const PlanStep = ({ onSelect }: { onSelect: (plan: string) => void }) => {
  const plans = [
    { id: 'free', name: 'Grátis', price: 'R$ 0', features: ['3 Créditos de bônus', 'Estilo Executivo', 'Alta Fidelidade'], color: 'bg-slate-100' },
    { id: 'pro', name: 'Pro', price: 'R$ 29,90', features: ['50 Créditos/mês', 'Todos os Estilos', 'Suporte Prioritário'], color: 'bg-navy text-white', popular: true },
    { id: 'business', name: 'Business', price: 'R$ 99,90', features: ['Créditos Ilimitados', 'API Access', 'Faturamento PJ'], color: 'bg-slate-900 text-white' }
  ];

  return (
    <div className="flex flex-col min-h-screen px-6 pt-24 pb-10">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-navy mb-2">Escolha seu Plano</h2>
        <p className="text-slate-500">Potencialize sua imagem profissional.</p>
      </div>

      <div className="space-y-4">
        {plans.map((plan) => (
          <button
            key={plan.id}
            onClick={() => onSelect(plan.id)}
            className={`w-full text-left p-6 rounded-2xl border-2 transition-all relative overflow-hidden ${
              plan.popular ? 'border-navy shadow-xl' : 'border-slate-100'
            } ${plan.color}`}
          >
            {plan.popular && (
              <div className="absolute top-0 right-0 bg-yellow-400 text-navy text-[10px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-widest">
                Mais Popular
              </div>
            )}
            <h3 className="text-xl font-black mb-1">{plan.name}</h3>
            <p className="text-2xl font-bold mb-4">{plan.price}<span className="text-xs font-normal opacity-70">/mês</span></p>
            <ul className="space-y-2">
              {plan.features.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-sm opacity-80">
                  <CheckCircle2 className="w-4 h-4" />
                  {f}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>
    </div>
  );
};

const LandingPage = ({ onStart, user, profile }: { onStart: () => void, user: FirebaseUser | null, profile: UserProfile | null }) => (
  <div className="flex flex-col items-center justify-center min-h-screen px-6 pt-20 pb-10 text-center">
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md"
    >
      {user ? (
        <div className="mb-6 p-4 glass-card border-navy/20 bg-navy/5">
          <p className="text-xs font-bold text-navy uppercase tracking-widest mb-1">Bem-vindo de volta,</p>
          <p className="text-lg font-black text-navy">{profile?.displayName || user.displayName}</p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="px-2 py-0.5 bg-navy text-white text-[10px] font-bold rounded-full uppercase">Plano {profile?.plan || 'Free'}</span>
            <span className="text-xs font-bold text-navy/60">{profile?.credits || 0} Créditos Disponíveis</span>
          </div>
        </div>
      ) : (
        <span className="inline-block px-3 py-1 mb-4 text-xs font-bold tracking-wider text-navy uppercase bg-navy/10 rounded-full flex items-center gap-2 mx-auto w-fit">
          <Sparkles className="w-3 h-3" />
          IA Generativa de Elite
        </span>
      )}
      
      <h1 className="text-4xl font-extrabold text-navy leading-tight mb-4">
        Arquitetura de Imagem Profissional
      </h1>
      <p className="text-lg text-slate-600 mb-8">
        Gere prompts técnicos de alta fidelidade para o Veo 3.
      </p>
      
      <div className="relative w-full aspect-[4/3] mb-10 rounded-2xl overflow-hidden shadow-2xl">
        <img 
          src="https://picsum.photos/seed/portrait-pro/800/600" 
          alt="Exemplo de retrato corporativo" 
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-navy/60 to-transparent flex items-end p-6 text-left">
          <div className="flex items-center gap-3 text-white">
            <div className="flex -space-x-2">
              {[1,2,3].map(i => (
                <img key={i} src={`https://i.pravatar.cc/100?u=${i}`} className="w-8 h-8 rounded-full border-2 border-white" alt="User" referrerPolicy="no-referrer" />
              ))}
            </div>
            <p className="text-sm font-medium">+10.000 profissionais já usaram</p>
          </div>
        </div>
      </div>

      <button onClick={onStart} className="btn-primary w-full flex items-center justify-center gap-2 text-lg py-4">
        Começar Agora (3 Créditos Grátis)
        <ArrowRight className="w-5 h-5" />
      </button>
      
      <div className="mt-8 flex flex-col items-center gap-4">
        <div className="flex items-center justify-center gap-6 text-slate-400">
          <div className="flex items-center gap-1 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Alta Fidelidade
          </div>
          <div className="flex items-center gap-1 text-xs font-medium">
            <Zap className="w-4 h-4" />
            Pronto p/ Copiar
          </div>
        </div>
        <p className="text-[10px] text-slate-400 font-medium">
          Pagamento único de R$ 0,50 via PIX. Liberação imediata.
        </p>
      </div>
    </motion.div>
  </div>
);

const UploadStep = ({ onNext }: { onNext: (img: string) => void }) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setSelectedImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col min-h-screen px-6 pt-24 pb-10">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-navy mb-2">Envie sua melhor foto</h2>
        <p className="text-slate-500">Nossa IA precisa de uma referência clara do seu rosto.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="glass-card p-4 flex flex-col items-center text-center">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mb-2">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Pode</p>
          <p className="text-xs text-slate-600 leading-tight">Boa iluminação, rosto visível e centralizado.</p>
        </div>
        <div className="glass-card p-4 flex flex-col items-center text-center">
          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mb-2">
            <XCircle className="w-6 h-6 text-red-600" />
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Não Pode</p>
          <p className="text-xs text-slate-600 leading-tight">Óculos escuros, bonés ou fotos em grupo.</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <label className="relative flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl bg-white hover:bg-slate-50 transition-colors cursor-pointer overflow-hidden">
          <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
          
          {selectedImage ? (
            <img src={selectedImage} className="w-full h-full object-cover" alt="Preview" />
          ) : (
            <div className="flex flex-col items-center p-6">
              <div className="w-16 h-16 bg-navy/5 rounded-full flex items-center justify-center mb-4">
                <Upload className="w-8 h-8 text-navy" />
              </div>
              <p className="font-semibold text-navy mb-1">Toque para selecionar</p>
              <p className="text-sm text-slate-400">Galeria ou Câmera</p>
            </div>
          )}
          
          {selectedImage && (
            <div className="absolute bottom-4 right-4 bg-navy text-white p-2 rounded-full shadow-lg">
              <Camera className="w-5 h-5" />
            </div>
          )}
        </label>

        <button 
          disabled={!selectedImage}
          onClick={() => selectedImage && onNext(selectedImage)}
          className={`mt-8 w-full py-4 rounded-xl font-bold text-lg transition-all shadow-lg flex items-center justify-center gap-2 ${
            selectedImage ? 'bg-navy text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          Continuar
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

const StyleStep = ({ uploadedImage, onNext }: { uploadedImage: string, onNext: (styleId: string, editedPrompt: string) => void }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [editedPrompt, setEditedPrompt] = useState("");

  useEffect(() => {
    if (recommendation) return; // Avoid redundant calls
    const getRec = async () => {
      try {
        const rec = await recommendStyle(uploadedImage);
        setRecommendation(rec);
      } catch (err) {
        console.error("Erro ao recomendar estilo:", err);
      } finally {
        setIsAnalyzing(false);
      }
    };
    getRec();
  }, [uploadedImage, recommendation]);

  const handleStyleSelect = (id: string) => {
    setSelected(id);
    const style = STYLES.find(s => s.id === id);
    if (style) {
      setEditedPrompt(style.prompt);
    }
  };

  return (
    <div className="flex flex-col min-h-screen px-6 pt-24 pb-10">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-navy mb-2">Escolha seu estilo</h2>
        <p className="text-slate-500">Como você quer ser visto no mercado?</p>
      </div>

      {isAnalyzing ? (
        <div className="bg-navy/5 rounded-xl p-4 mb-6 flex items-center gap-3 animate-pulse">
          <Loader2 className="w-5 h-5 text-navy animate-spin" />
          <p className="text-xs font-bold text-navy uppercase tracking-wider">Arquiteto Veo 3 analisando seu perfil...</p>
        </div>
      ) : recommendation && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-navy text-white rounded-xl p-4 mb-6 flex items-center gap-3 shadow-lg"
        >
          <Sparkles className="w-5 h-5 text-yellow-400 fill-yellow-400" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Recomendação da IA</p>
            <p className="text-xs font-medium">O estilo <span className="font-bold underline">
              {STYLES.find(s => s.id === recommendation)?.title}
            </span> combina perfeitamente com você!</p>
          </div>
        </motion.div>
      )}

      <div className="space-y-4 flex-1">
        {STYLES.map((style) => (
          <button
            key={style.id}
            onClick={() => handleStyleSelect(style.id)}
            className={`w-full text-left glass-card p-4 flex items-center gap-4 transition-all border-2 ${
              selected === style.id ? 'border-navy bg-navy/5' : 'border-transparent'
            } ${recommendation === style.id && !selected ? 'ring-2 ring-navy/20' : ''}`}
          >
            <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0">
              <img src={style.image} className="w-full h-full object-cover" alt={style.title} referrerPolicy="no-referrer" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-navy">{style.icon}</span>
                <h3 className="font-bold text-navy">{style.title}</h3>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{style.description}</p>
            </div>
            {selected === style.id && (
              <div className="w-6 h-6 bg-navy rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-white" />
              </div>
            )}
          </button>
        ))}

        {selected && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-6"
          >
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-navy" />
              <label className="text-xs font-bold text-navy uppercase tracking-wider">Ajuste Criativo (Opcional)</label>
            </div>
            <textarea 
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
              className="w-full p-4 glass-card border-navy/10 focus:border-navy focus:ring-1 focus:ring-navy outline-none text-xs text-slate-600 leading-relaxed min-h-[100px] resize-none"
              placeholder="Adicione detalhes como: fundo de biblioteca, luz de pôr do sol, etc."
            />
            <p className="text-[10px] text-slate-400 mt-2 italic">
              * O Arquiteto Veo 3 usará sua edição para refinar o resultado final.
            </p>
          </motion.div>
        )}
      </div>

      <button 
        disabled={!selected}
        onClick={() => selected && onNext(selected, editedPrompt)}
        className={`mt-8 w-full py-4 rounded-xl font-bold text-lg transition-all shadow-lg flex items-center justify-center gap-2 ${
          selected ? 'bg-navy text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
        }`}
      >
        Confirmar Estilo
        <ArrowRight className="w-5 h-5" />
      </button>
    </div>
  );
};

const CheckoutStep = ({ onNext, planId, credits }: { onNext: () => void, planId: string | null, credits: number }) => {
  const getPlanInfo = () => {
    if (planId === 'pro') return { name: 'Plano PRO Mensal', price: 'R$ 29,90', oldPrice: 'R$ 59,90' };
    if (planId === 'business') return { name: 'Plano BUSINESS Mensal', price: 'R$ 99,90', oldPrice: 'R$ 199,90' };
    return { name: 'Créditos Avulsos', price: 'R$ 0,50', oldPrice: 'R$ 49,90' };
  };

  const info = getPlanInfo();

  return (
    <div className="flex flex-col min-h-screen px-6 pt-24 pb-10">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-navy mb-2">Resumo do Pedido</h2>
        <p className="text-slate-500">Liberação instantânea via PIX Mercado Pago.</p>
      </div>

      <div className="glass-card p-6 mb-8">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="font-bold text-lg text-navy">{info.name}</h3>
            <p className="text-sm text-slate-500">Ensaio Estruturado Veo 3</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400 line-through">{info.oldPrice}</p>
            <p className="text-2xl font-black text-navy">{info.price}</p>
          </div>
        </div>

        <div className="space-y-3 border-t border-slate-100 pt-6">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            {planId ? 'Assinatura Mensal Ativa' : 'Liberação de todos os estilos'}
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Engenharia de Prompt Veo 3
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Cópia ilimitada de comandos
          </div>
        </div>
      </div>

      <div className="flex-1">
        {credits > 0 && (
          <div className="bg-green-50 border border-green-100 rounded-xl p-4 flex items-center gap-3 mb-6">
            <Sparkles className="w-6 h-6 text-green-600" />
            <div>
              <p className="text-xs font-bold text-green-800 uppercase tracking-wider">Você tem créditos!</p>
              <p className="text-[10px] text-green-700">Este ensaio consumirá 1 crédito do seu saldo.</p>
            </div>
          </div>
        )}
        <div className="bg-navy/5 rounded-xl p-4 flex items-center gap-3 mb-6">
          <ShieldCheck className="w-6 h-6 text-navy" />
          <div>
            <p className="text-xs font-bold text-navy uppercase tracking-wider">Pagamento Seguro</p>
            <p className="text-[10px] text-slate-500">PIX com aprovação instantânea e Cartão</p>
          </div>
        </div>
      </div>

      <button 
        onClick={onNext}
        className="w-full py-4 bg-navy text-white rounded-xl font-bold text-lg transition-all shadow-lg flex items-center justify-center gap-2"
      >
        {credits > 0 ? 'Usar 1 Crédito' : 'Ir para o Pagamento'}
        <Zap className="w-5 h-5 fill-white" />
      </button>
      
      <p className="text-center text-[10px] text-slate-400 mt-4">
        Ao clicar, você concorda com nossos Termos de Uso e Política de Privacidade.
      </p>
    </div>
  );
};

const ProcessingStep = ({ 
  uploadedImage, 
  styleId, 
  customPrompt,
  onComplete 
}: { 
  uploadedImage: string, 
  styleId: string, 
  customPrompt?: string,
  onComplete: (results: GeneratedResult[]) => void 
}) => {
  const [progress, setProgress] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const startGeneration = useCallback(async () => {
    try {
      const style = STYLES.find(s => s.id === styleId);
      if (!style) throw new Error("Style not found");

      const basePrompt = customPrompt || style.prompt;

      // Generate variations sequentially to avoid hitting rate limits (429)
      const results: GeneratedResult[] = [];
      
      const res1 = await generateStructuredPrompt(uploadedImage, basePrompt);
      results.push(res1);
      
      // Increased delay between calls to be very safe
      await delay(3000);
      
      const res2 = await generateStructuredPrompt(uploadedImage, basePrompt + " slightly different angle, warmer lighting");
      results.push(res2);

      onComplete(results);
    } catch (err: any) {
      const errorStr = JSON.stringify(err).toLowerCase();
      const isQuotaError = 
        err?.message?.includes('429') || 
        err?.message?.includes('RESOURCE_EXHAUSTED') ||
        errorStr.includes('429') ||
        errorStr.includes('resource_exhausted') ||
        errorStr.includes('quota');

      if (isQuotaError) {
        setError("O servidor de IA está temporariamente sobrecarregado. Por favor, aguarde 30 segundos e tente novamente.");
      } else {
        setError("Ocorreu um erro técnico ao arquitetar seus prompts. Por favor, tente novamente.");
      }
      console.error(err);
    }
  }, [uploadedImage, styleId, customPrompt, onComplete]);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) return 95; // Wait for AI
        return prev + 1;
      });
    }, 100);

    const statusInterval = setInterval(() => {
      setStatusIndex(prev => (prev + 1) % STATUS_MESSAGES.length);
    }, 2000);

    startGeneration();

    return () => {
      clearInterval(interval);
      clearInterval(statusInterval);
    };
  }, [startGeneration]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-10 text-center">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
          <XCircle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold text-navy mb-2">Ops! Algo deu errado</h2>
        <p className="text-slate-500 text-sm mb-8 leading-relaxed">{error}</p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button 
            onClick={() => {
              setError(null);
              setProgress(0);
              startGeneration();
            }} 
            className="w-full py-4 bg-navy text-white rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2"
          >
            <RefreshCcw className="w-4 h-4" />
            Tentar Novamente
          </button>
          <button 
            onClick={() => window.location.reload()} 
            className="w-full py-4 bg-white text-slate-400 font-medium text-sm"
          >
            Recarregar App
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-10 text-center bg-white">
      <motion.div 
        animate={{ rotate: 360 }}
        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        className="mb-8"
      >
        <Loader2 className="w-16 h-16 text-navy opacity-20" />
      </motion.div>
      
      <h2 className="text-2xl font-bold text-navy mb-2">Pagamento Confirmado!</h2>
      <p className="text-slate-500 text-sm mb-6">Arquitetando seus Prompts...</p>
      <p className="text-slate-400 mb-10 h-6 transition-all duration-500">
        {STATUS_MESSAGES[statusIndex]}
      </p>

      <div className="w-full max-w-xs h-2 bg-slate-100 rounded-full overflow-hidden mb-4">
        <motion.div 
          className="h-full bg-navy"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-sm font-bold text-navy">{progress}%</p>

      <div className="mt-12 p-4 glass-card text-left max-w-xs">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-navy" />
          <span className="text-[10px] font-bold text-navy uppercase tracking-widest">Veo 3 Architect Engine</span>
        </div>
        <p className="text-[10px] text-slate-500 italic leading-relaxed">
          "Otimizando parâmetros de iluminação volumétrica e consistência temporal para máxima fidelidade corporativa..."
        </p>
      </div>
    </div>
  );
};

const STATIC_PIX_CODE = "00020126360014br.gov.bcb.pix0114+551191969293952040000530398654040.505802BR5924Cleber Clemente dos Sant6009Sao Paulo62230519daqr257107316218233630477F2";

const PaymentStep = ({ onNext, email, planId }: { onNext: () => void, email: string, planId: string | null }) => {
  const [paymentData, setPaymentData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [useStatic, setUseStatic] = useState(false);

  const getPrice = () => {
    if (planId === 'pro') return "R$ 29,90";
    if (planId === 'business') return "R$ 99,90";
    return "R$ 0,50";
  };

  const createPayment = async () => {
    setLoading(true);
    setError(null);
    setUseStatic(false);
    try {
      const response = await fetch('/api/payment/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, planId })
      });
      const data = await response.json();
      if (data.error) {
        // If API fails (e.g. no token), fallback to static Pix
        setUseStatic(true);
        setLoading(false);
        return;
      }
      setPaymentData(data);
    } catch (err: any) {
      setUseStatic(true);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    createPayment();
  }, []);

  useEffect(() => {
    if (!paymentData?.id) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/payment/status/${paymentData.id}`);
        const data = await response.json();
        if (data.status === 'approved') {
          clearInterval(interval);
          onNext();
        }
      } catch (err) {
        console.error("Erro ao verificar status:", err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [paymentData?.id, onNext]);

  const copyPix = () => {
    const code = useStatic ? STATIC_PIX_CODE : paymentData?.qr_code;
    if (code) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <Loader2 className="w-12 h-12 text-navy animate-spin mb-4" />
        <h2 className="text-xl font-bold text-navy">Gerando seu PIX...</h2>
        <p className="text-slate-500 text-sm">Aguarde um instante.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen px-6 pt-24 pb-10">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-navy mb-2">Pagamento via PIX</h2>
        <p className="text-slate-500 text-sm">Escaneie o QR Code ou copie o código para pagar.</p>
      </div>

      <div className="glass-card p-6 mb-8 flex flex-col items-center">
        <div className="w-48 h-48 bg-white p-2 rounded-xl shadow-inner mb-6 border border-slate-100 flex items-center justify-center overflow-hidden">
          {useStatic ? (
            <QRCodeCanvas 
              value={STATIC_PIX_CODE} 
              size={180}
              level="H"
              includeMargin={false}
            />
          ) : paymentData?.qr_code ? (
            <QRCodeCanvas 
              value={paymentData.qr_code} 
              size={180}
              level="H"
              includeMargin={false}
            />
          ) : paymentData?.qr_code_base64 ? (
            <img 
              src={`data:image/png;base64,${paymentData.qr_code_base64}`} 
              className="w-full h-full" 
              alt="QR Code PIX" 
            />
          ) : (
            <QrCode className="w-12 h-12 text-slate-200" />
          )}
        </div>

        <div className="w-full space-y-4">
          {!useStatic && paymentData?.id && (
            <div className="text-center mb-2">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">ID do Pagamento: <span className="text-navy font-mono">{paymentData.id}</span></p>
            </div>
          )}
          <div className="bg-navy/5 p-4 rounded-xl border border-navy/10">
            <p className="text-[10px] font-bold text-navy uppercase tracking-widest mb-2">Código PIX (Copia e Cola)</p>
            <div className="flex items-center gap-2">
              <input 
                readOnly 
                value={useStatic ? STATIC_PIX_CODE : (paymentData?.qr_code || "")} 
                className="flex-1 bg-transparent text-xs text-navy font-mono truncate outline-none"
              />
              <button 
                onClick={copyPix}
                className="p-2 bg-navy text-white rounded-lg active:scale-90 transition-all"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {useStatic ? (
            <button 
              onClick={onNext}
              className="w-full py-3 bg-green-600 text-white rounded-xl font-bold text-sm shadow-lg flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Já realizei o pagamento
            </button>
          ) : (
            <div className="flex items-center gap-3 text-xs text-slate-500 bg-slate-50 p-3 rounded-lg">
              <Loader2 className="w-4 h-4 animate-spin text-navy" />
              Aguardando confirmação do pagamento...
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Valor a pagar:</span>
          <span className="font-bold text-navy">{getPrice()}</span>
        </div>
        <div className="bg-yellow-50 border border-yellow-100 p-3 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
          <p className="text-[10px] text-yellow-700 leading-relaxed">
            Após o pagamento, a liberação é automática. Não feche esta tela até a confirmação.
          </p>
        </div>
      </div>
    </div>
  );
};

const ResultStep = ({ results, onRestart, onGenerateVideo }: { 
  results: GeneratedResult[], 
  onRestart: () => void,
  onGenerateVideo: (prompt: string) => void
}) => {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const shareText = (text: string) => {
    if (navigator.share) {
      navigator.share({
        title: 'Prompt Profissional Veo 3',
        text: text,
      }).catch(console.error);
    } else {
      alert('Compartilhamento não suportado neste navegador.');
    }
  };

  const formatPrompt = (res: GeneratedResult) => {
    return `TITLE: ${res.title}\n\nNARRATIVE PROMPT:\n${res.narrative}\n\nSTRUCTURED DETAILS:\n- Visual Style: ${res.structured.visual_style}\n- Camera: ${res.structured.camera_settings}\n- Lighting: ${res.structured.lighting}\n- Subject: ${res.structured.subject_details}\n- Environment: ${res.structured.environment}\n- Script: ${res.structured.script_sync}`;
  };

  return (
    <div className="flex flex-col min-h-screen px-6 pt-24 pb-10">
      <div className="mb-8 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-navy mb-2">Seus Prompts estão prontos!</h2>
        <p className="text-slate-500 text-sm">Copie os comandos técnicos abaixo para usar no Veo 3 ou outros modelos de IA.</p>
      </div>

      <div className="space-y-6 mb-8">
        {results.map((res, idx) => {
          const fullText = formatPrompt(res);
          return (
            <div key={idx} className="glass-card overflow-hidden border border-navy/5">
              <div className="p-5 bg-white">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-navy/10 rounded flex items-center justify-center text-[10px] font-bold text-navy">
                      0{idx + 1}
                    </div>
                    <h4 className="font-bold text-navy text-sm">{res.title}</h4>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => copyToClipboard(fullText, idx)}
                      className="p-2 bg-navy/5 text-navy rounded-lg active:scale-90 transition-all flex items-center gap-1.5"
                    >
                      {copiedIdx === idx ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      <span className="text-[10px] font-bold">{copiedIdx === idx ? 'Copiado' : 'Copiar'}</span>
                    </button>
                    <button 
                      onClick={() => shareText(fullText)}
                      className="p-2 bg-navy/5 text-navy rounded-lg active:scale-90 transition-all"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Narrative Prompt (English)</p>
                    <p className="text-xs text-slate-600 leading-relaxed font-mono italic">"{res.narrative}"</p>
                  </div>

                  <button 
                    onClick={() => onGenerateVideo(res.narrative)}
                    className="w-full py-3 bg-gradient-to-r from-navy to-indigo-900 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
                  >
                    <Video className="w-4 h-4" />
                    Gerar Vídeo com Veo 3 (Flow)
                  </button>

                  <div className="grid grid-cols-1 gap-3">
                    {Object.entries(res.structured).map(([key, val]) => (
                      <div key={key} className="flex flex-col gap-0.5">
                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">{key.replace('_', ' ')}</p>
                        <p className="text-[10px] text-navy font-medium bg-navy/5 px-2 py-1 rounded border border-navy/5">{String(val)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button 
        onClick={() => {
          const allText = results.map(formatPrompt).join('\n\n' + '='.repeat(20) + '\n\n');
          copyToClipboard(allText, 999);
        }}
        className="w-full py-4 bg-navy text-white rounded-xl font-bold text-lg transition-all shadow-lg flex items-center justify-center gap-2"
      >
        <Copy className="w-5 h-5" />
        {copiedIdx === 999 ? 'Tudo Copiado!' : 'Copiar Todos os Prompts'}
      </button>
      
      <button 
        onClick={onRestart}
        className="mt-4 w-full py-4 bg-white text-navy border border-navy/10 rounded-xl font-bold flex items-center justify-center gap-2"
      >
        <RefreshCcw className="w-4 h-4" />
        Novo Ensaio
      </button>
    </div>
  );
};

const VideoGenerationStep = ({ 
  prompt, 
  image, 
  onBack 
}: { 
  prompt: string, 
  image: string, 
  onBack: () => void 
}) => {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  const generateVideo = async () => {
    setLoading(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const base64Data = image.split(',')[1] || image;
      const mimeType = image.split(';')[0].split(':')[1] || 'image/jpeg';

      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: prompt,
        image: {
          imageBytes: base64Data,
          mimeType: mimeType,
        },
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '9:16'
        }
      });

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!downloadLink) throw new Error("Falha ao obter link do vídeo");

      const response = await fetch(downloadLink, {
        method: 'GET',
        headers: {
          'x-goog-api-key': process.env.API_KEY || '',
        },
      });
      
      const blob = await response.blob();
      setVideoUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes("Requested entity was not found")) {
        setHasKey(false);
        setError("Sua chave de API expirou ou é inválida. Por favor, selecione novamente.");
      } else {
        setError("Erro ao gerar vídeo. Certifique-se de que sua conta tem faturamento ativo no Google Cloud.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (hasKey === false) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-10 text-center">
        <Key className="w-12 h-12 text-navy mb-4 opacity-20" />
        <h2 className="text-xl font-bold text-navy mb-2">Chave de API Necessária</h2>
        <p className="text-slate-500 text-sm mb-8">
          Para usar o gerador Veo 3 (Flow), você precisa selecionar uma chave de API com faturamento ativo.
        </p>
        <button 
          onClick={handleSelectKey}
          className="w-full py-4 bg-navy text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg"
        >
          Selecionar Chave de API
        </button>
        <button onClick={onBack} className="mt-4 text-slate-400 text-sm font-medium">Voltar</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen px-6 pt-24 pb-10">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-navy mb-2">Gerador Veo 3 (Flow)</h2>
        <p className="text-slate-500 text-sm">Transformando seu prompt em realidade cinematográfica.</p>
      </div>

      <div className="glass-card p-4 mb-8">
        {videoUrl ? (
          <video 
            src={videoUrl} 
            controls 
            autoPlay 
            loop 
            className="w-full rounded-lg shadow-inner aspect-[9/16] bg-black"
          />
        ) : (
          <div className="aspect-[9/16] bg-slate-100 rounded-lg flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-200">
            {loading ? (
              <>
                <Loader2 className="w-10 h-10 text-navy animate-spin mb-4" />
                <p className="text-sm font-bold text-navy mb-1">Gerando Vídeo...</p>
                <p className="text-[10px] text-slate-400">Isso pode levar de 1 a 3 minutos.</p>
              </>
            ) : (
              <>
                <Video className="w-12 h-12 text-slate-300 mb-4" />
                <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                  Pronto para gerar o vídeo baseado no seu prompt arquitetado.
                </p>
                <button 
                  onClick={generateVideo}
                  className="w-full py-3 bg-navy text-white rounded-xl font-bold text-sm shadow-md"
                >
                  Iniciar Geração
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-xl mb-6 flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-[10px] text-red-700 leading-relaxed">{error}</p>
        </div>
      )}

      <div className="mt-auto">
        {videoUrl && (
          <a 
            href={videoUrl} 
            download="veo3-video.mp4"
            className="w-full py-4 bg-green-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg mb-4"
          >
            <Download className="w-5 h-5" />
            Baixar Vídeo
          </a>
        )}
        <button 
          onClick={onBack}
          className="w-full py-4 bg-white text-navy border border-navy/10 rounded-xl font-bold"
        >
          Voltar para os Prompts
        </button>
      </div>
    </div>
  );
};

const UserAreaStep = ({ 
  profile, 
  onBack, 
  onLogout,
  onUpgrade 
}: { 
  profile: UserProfile | null, 
  onBack: () => void, 
  onLogout: () => void,
  onUpgrade: () => void
}) => {
  const [generations, setGenerations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.uid) {
      const q = query(
        collection(db, 'generations'), 
        where('userId', '==', profile.uid),
        orderBy('createdAt', 'desc'),
        limit(10)
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setGenerations(docs);
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'generations');
        setLoading(false);
      });

      return () => unsubscribe();
    }
  }, [profile?.uid]);

  return (
    <div className="flex flex-col min-h-screen px-6 pt-24 pb-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-navy mb-1">Área do Usuário</h2>
          <p className="text-slate-500 text-xs">Gerencie sua conta e histórico.</p>
        </div>
        <button 
          onClick={onLogout}
          className="p-2 bg-red-50 text-red-600 rounded-lg active:scale-95 transition-all"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      {/* Profile Card */}
      <div className="glass-card p-5 mb-6 bg-gradient-to-br from-white to-slate-50/50">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-navy/10 flex items-center justify-center overflow-hidden border-2 border-white shadow-sm">
            {profile?.displayName ? (
              <span className="text-2xl font-bold text-navy">{profile.displayName[0]}</span>
            ) : (
              <User className="w-8 h-8 text-navy/40" />
            )}
          </div>
          <div>
            <h3 className="font-bold text-navy text-lg">{profile?.displayName || 'Usuário'}</h3>
            <p className="text-slate-500 text-xs">{profile?.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-3 h-3 text-navy" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Créditos</span>
            </div>
            <p className="text-xl font-black text-navy">{profile?.credits || 0}</p>
          </div>
          <div className="p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Crown className="w-3 h-3 text-amber-500" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Plano</span>
            </div>
            <p className="text-sm font-bold text-navy capitalize">{profile?.plan || 'Free'}</p>
          </div>
        </div>

        {profile?.credits === 0 && (
          <button 
            onClick={onUpgrade}
            className="w-full mt-4 py-3 bg-navy text-white rounded-xl font-bold text-xs shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <Zap className="w-4 h-4 fill-white" />
            ADQUIRIR MAIS CRÉDITOS
          </button>
        )}
      </div>

      {/* History */}
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4 text-navy" />
          <h3 className="font-bold text-navy text-sm uppercase tracking-wider">Histórico Recente</h3>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 opacity-20">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : generations.length > 0 ? (
          <div className="space-y-3">
            {generations.map((gen) => (
              <div key={gen.id} className="p-4 bg-white rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {gen.createdAt?.toDate ? gen.createdAt.toDate().toLocaleDateString('pt-BR') : 'Recent'}
                  </span>
                  <span className="px-2 py-0.5 bg-navy/5 text-navy text-[9px] font-bold rounded-md uppercase">
                    {gen.results?.length || 0} Prompts
                  </span>
                </div>
                <p className="text-xs text-navy font-medium line-clamp-2 italic mb-2">
                  "{gen.results?.[0]?.narrative || 'Sem descrição'}"
                </p>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
                    <Video className="w-3 h-3 text-slate-400" />
                  </div>
                  <span className="text-[10px] text-slate-500">Arquitetura Veo 3</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center px-6 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
            <History className="w-10 h-10 text-slate-300 mb-3" />
            <p className="text-sm font-bold text-slate-400 mb-1">Nenhuma geração ainda</p>
            <p className="text-[10px] text-slate-400">Suas criações aparecerão aqui automaticamente.</p>
          </div>
        )}
      </div>

      <button 
        onClick={onBack}
        className="w-full mt-8 py-4 bg-white text-navy border border-navy/10 rounded-xl font-bold active:scale-95 transition-all"
      >
        Voltar ao Início
      </button>
    </div>
  );
};

// --- Main App ---

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

const ErrorBoundary: any = class extends Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    const self = this as any;
    if (self.state.hasError) {
      let errorMessage = "Algo deu errado.";
      try {
        const parsed = JSON.parse(self.state.error.message);
        if (parsed.error) errorMessage = `Erro no Firestore: ${parsed.error} (${parsed.operationType} em ${parsed.path})`;
      } catch (e) {
        errorMessage = self.state.error?.message || errorMessage;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center bg-white">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-navy mb-2">Ops! Ocorreu um erro</h2>
          <p className="text-slate-500 text-sm mb-6 max-w-xs">{errorMessage}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-navy text-white rounded-xl font-bold active:scale-95 transition-all"
          >
            Recarregar Aplicativo
          </button>
        </div>
      );
    }

    return self.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [step, setStep] = useState<Step>('landing');
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [videoPrompt, setVideoPrompt] = useState<string>("");
  const [results, setResults] = useState<GeneratedResult[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const userRef = doc(db, 'users', firebaseUser.uid);
        
        try {
          const userSnap = await getDoc(userRef);
          
          if (!userSnap.exists()) {
            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              displayName: firebaseUser.displayName || 'Usuário',
              credits: 3,
              plan: 'free',
              role: 'user',
              createdAt: serverTimestamp()
            };
            await setDoc(userRef, newProfile);
            setProfile(newProfile);
          }
          
          onSnapshot(userRef, (doc) => {
            if (doc.exists()) {
              setProfile(doc.data() as UserProfile);
            }
          }, (err) => handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`));
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      } else {
        setProfile(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const nextStep = (next: Step) => {
    if (!user && next !== 'landing' && next !== 'auth') {
      setStep('auth');
      return;
    }
    setStep(next);
  };

  const prevStep = () => {
    const steps: Step[] = ['landing', 'plans', 'upload', 'style', 'checkout', 'payment'];
    const currentIdx = steps.indexOf(step);
    if (currentIdx > 0) setStep(steps[currentIdx - 1]);
    else if (step === 'auth') setStep('landing');
  };

  const handleGenerationComplete = async (newResults: GeneratedResult[]) => {
    if (profile && profile.credits > 0) {
      const userRef = doc(db, 'users', user!.uid);
      try {
        await updateDoc(userRef, {
          credits: increment(-1)
        });

        // Save to history
        await addDoc(collection(db, 'generations'), {
          userId: user!.uid,
          results: newResults,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${user!.uid}`);
      }
    }
    setResults(newResults);
    setStep('result');
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setStep('auth');
      setProfile(null);
    } catch (error) {
      console.error("Logout error", error);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-10 h-10 text-navy animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-business-gray min-h-screen relative overflow-x-hidden">
      <Header 
        showBack={['auth', 'plans', 'upload', 'style', 'checkout', 'payment', 'result', 'video', 'user'].includes(step)} 
        onBack={() => {
          if (step === 'user') setStep('landing');
          else prevStep();
        }}
        user={user}
        credits={profile?.credits || 0}
        onUpgrade={() => setStep('plans')}
        onUserArea={() => setStep('user')}
      />

      <main>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {step === 'landing' && <LandingPage user={user} profile={profile} onStart={() => nextStep(user ? 'upload' : 'auth')} />}
            {step === 'auth' && <AuthStep onAuth={() => setStep('landing')} />}
            {step === 'plans' && <PlanStep onSelect={(planId) => {
              setSelectedPlanId(planId);
              if (planId === 'free') setStep('upload');
              else setStep('payment');
            }} />}
            {step === 'upload' && (
              <UploadStep onNext={(img) => {
                setUploadedImage(img);
                nextStep('style');
              }} />
            )}
            {step === 'style' && uploadedImage && (
              <StyleStep 
                uploadedImage={uploadedImage}
                onNext={(styleId, editedPrompt) => {
                  setSelectedStyleId(styleId);
                  setCustomPrompt(editedPrompt);
                  nextStep('checkout');
                }} 
              />
            )}
            {step === 'checkout' && (
              <CheckoutStep 
                planId={selectedPlanId} 
                credits={profile?.credits || 0}
                onNext={() => {
                  if (profile && profile.credits > 0) {
                    setStep('processing');
                  } else {
                    nextStep('payment');
                  }
                }} 
              />
            )}
            {step === 'payment' && <PaymentStep 
              email={user?.email || ''} 
              planId={selectedPlanId}
              onNext={async () => {
                if (user && selectedPlanId) {
                  const userRef = doc(db, 'users', user.uid);
                  const creditsToAdd = selectedPlanId === 'pro' ? 50 : (selectedPlanId === 'business' ? 1000 : 1);
                  try {
                    await updateDoc(userRef, {
                      credits: increment(creditsToAdd),
                      plan: selectedPlanId
                    });
                  } catch (err) {
                    handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
                  }
                }
                setStep('processing');
              }} 
            />}
            {step === 'processing' && uploadedImage && selectedStyleId && (
              <ProcessingStep 
                uploadedImage={uploadedImage}
                styleId={selectedStyleId}
                customPrompt={customPrompt}
                onComplete={handleGenerationComplete}
              />
            )}
            {step === 'result' && (
              <ResultStep 
                results={results} 
                onRestart={() => setStep('landing')} 
                onGenerateVideo={(p) => {
                  setVideoPrompt(p);
                  setStep('video');
                }}
              />
            )}
            {step === 'video' && uploadedImage && (
              <VideoGenerationStep 
                prompt={videoPrompt}
                image={uploadedImage}
                onBack={() => setStep('result')}
              />
            )}
            {step === 'user' && (
              <UserAreaStep 
                profile={profile}
                onBack={() => setStep('landing')}
                onLogout={handleLogout}
                onUpgrade={() => setStep('plans')}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {step === 'landing' && (
        <footer className="px-6 py-8 text-center border-t border-slate-200 mt-auto">
          <p className="text-xs text-slate-400">
            © 2026 CorpShot Brasil. Tecnologia de IA avançada para sua carreira.
          </p>
        </footer>
      )}
    </div>
  );
}
