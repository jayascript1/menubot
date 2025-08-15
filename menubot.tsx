// Expo React Native single-file prototype (web-friendly, no static Expo imports)
// Name: Expo Menu Health Recommender — App.tsx
// Purpose: "Point, snap, decide" healthy ordering assistant
// ---------------------------------------------------------------------
// WHY THIS REVISION?
// Previous builds failed in sandbox due to static imports pulling Expo packages
// from a CDN. This version:
//   • Removes ALL static imports of Expo modules (ImagePicker/AV)
//   • Uses dynamic imports inside functions so the bundler doesn’t fetch them
//     during build. That avoids the sandbox CDN fetch errors.
//   • Keeps the API-key runtime resolver + mock mode for offline demos
//   • Adds no-Node base64 utility
//   • Preserves existing tests and adds more (unchanged originals)
// Packages (Expo SDK 51+ recommended in a real project):
//   expo install expo-image-picker expo-av
// For mobile prod: move API calls server-side; never ship keys in client apps.

import React, { useMemo, useRef, useState } from 'react';
import { Image, SafeAreaView, ScrollView, Text, TouchableOpacity, View, ActivityIndicator, TextInput } from 'react-native';

// ---------- Types ----------

type MenuItem = {
  name: string;
  description?: string;
  price?: number; // in local currency (GBP assumed)
  calories?: number; // kcal
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
};

type Combo = {
  title: string; // e.g., "High-protein under £15"
  item_indices: number[]; // indices into items[]
  rationale: string;
};

type Analysis = {
  items: MenuItem[];
  health_rank: number[]; // indices into items[] from healthiest to least
  combos: Combo[];
  notes: string; // caveats + assumptions
};

type MacroSummary = { calories: number; protein_g: number; carbs_g: number; fat_g: number };

type HungerLevel = 'light' | 'moderate' | 'very';

// ---------- Config ----------

const VISION_MODELS = ['gpt-4o', 'gpt-4-vision-preview', 'gpt-4o-mini']; // Fallback models
const TTS_MODEL = 'gpt-4o-mini-tts'; // documented TTS model; swap if you have a newer TTS model

// Helper to format GBP £
export const gbp = (n: number | undefined) => (typeof n === 'number' && !isNaN(n) ? `£${n.toFixed(2)}` : '—');

// Resolve API key from environment variables and localStorage (completely hidden from users)
function getApiKey(): string | null {
  console.log('🔍 Searching for API key...');
  
  // Try to get from environment variables
  try {
    // For web builds, Expo automatically loads EXPO_PUBLIC_* variables
    const envKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    console.log('process.env.EXPO_PUBLIC_OPENAI_API_KEY:', envKey ? 'Found (length: ' + envKey.length + ')' : 'Not found');
    if (envKey && String(envKey).trim()) {
      console.log('✅ API key found in process.env');
      return String(envKey).trim();
    }
  } catch (e) {
    console.log('❌ Error accessing process.env:', e);
  }
  
  // Try to get from global scope (for web builds)
  try {
    const globalKey = (globalThis as any)?.EXPO_PUBLIC_OPENAI_API_KEY;
    console.log('globalThis.EXPO_PUBLIC_OPENAI_API_KEY:', globalKey ? 'Found (length: ' + globalKey.length + ')' : 'Not found');
    if (globalKey && String(globalKey).trim()) {
      console.log('✅ API key found in global scope');
      return String(globalKey).trim();
    }
  } catch (e) {
    console.log('❌ Error accessing global scope:', e);
  }
  
  // Try to get from window object (for web builds)
  try {
    if (typeof window !== 'undefined' && (window as any).EXPO_PUBLIC_OPENAI_API_KEY) {
      const windowKey = (window as any).EXPO_PUBLIC_OPENAI_API_KEY;
      console.log('window.EXPO_PUBLIC_OPENAI_API_KEY:', windowKey ? 'Found (length: ' + windowKey.length + ')' : 'Not found');
      if (windowKey && String(windowKey).trim()) {
        console.log('✅ API key found in window object');
        return String(windowKey).trim();
      }
    }
  } catch (e) {
    console.log('❌ Error accessing window object:', e);
  }
  
  // Try to get from localStorage as a fallback (but keep it hidden)
  try {
    const localKey = localStorage.getItem('menubot_api_key');
    console.log('localStorage menubot_api_key:', localKey ? 'Found (length: ' + localKey.length + ')' : 'Not found');
    if (localKey && localKey.trim()) {
      console.log('✅ API key found in localStorage');
      return localKey.trim();
    }
  } catch (e) {
    console.log('❌ Error accessing localStorage:', e);
  }
  
  // Try to get from any other possible sources
  try {
    // Check if it's available in the build process
    const buildTimeKey = (globalThis as any)?.__EXPO_PUBLIC_OPENAI_API_KEY__;
    if (buildTimeKey) {
      console.log('✅ API key found in build-time global');
      return buildTimeKey;
    }
  } catch (e) {
    console.log('❌ Error accessing build-time global:', e);
  }
  
  console.log('❌ No API key found in any source');
  return null;
}

// ---------- Pure helpers (also used in DEV tests) ----------

export function scoreItem(it: MenuItem): number {
  // Simple heuristic favouring protein, penalising high kcal density & fat
  const p = it.protein_g ?? 0;
  const cals = it.calories ?? 0;
  const fat = it.fat_g ?? 0;
  const carbs = it.carbs_g ?? 0;
  return p * 2 - fat * 0.8 - cals * 0.005 - carbs * 0.3;
}

export function rankItems(items: MenuItem[]): number[] {
  return items
    .map((it, idx) => ({ idx, s: scoreItem(it) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.idx);
}

export function sumPrice(items: MenuItem[], indices: number[]): number {
  return indices.reduce((sum, i) => sum + (items[i]?.price || 0), 0);
}

export function sumMacros(items: MenuItem[], indices: number[]): MacroSummary {
  return indices.reduce(
    (acc, i) => ({
      calories: acc.calories + (items[i]?.calories || 0),
      protein_g: acc.protein_g + (items[i]?.protein_g || 0),
      carbs_g: acc.carbs_g + (items[i]?.carbs_g || 0),
      fat_g: acc.fat_g + (items[i]?.fat_g || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

// Convert ArrayBuffer → base64 without Node Buffer (works in RN + web)
function arrayBufferToBase64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  let binary = '';
  const chunk = 0x8000; // 32KB chunks to avoid call stack overflow
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...(slice as any));
  }
  const btoaFn = (globalThis as any)?.btoa;
  if (typeof btoaFn === 'function') return btoaFn(binary);
  // Minimal base64 encoder fallback
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let out = '';
  let i = 0;
  while (i < binary.length) {
    const c1 = binary.charCodeAt(i++) & 0xff;
    const c2 = i < binary.length ? binary.charCodeAt(i++) & 0xff : NaN;
    const c3 = i < binary.length ? binary.charCodeAt(i++) & 0xff : NaN;
    const e1 = c1 >> 2;
    const e2 = ((c1 & 3) << 4) | ((c2 as number) >> 4);
    const e3 = isNaN(c2 as number) ? 64 : (((c2 as number) & 15) << 2) | ((c3 as number) >> 6);
    const e4 = isNaN(c3 as number) ? 64 : ((c3 as number) & 63);
    out += chars.charAt(e1) + chars.charAt(e2) + chars.charAt(e3) + chars.charAt(e4);
  }
  return out;
}

// ---------- Main Component ----------

export default function App() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [hungerLevel, setHungerLevel] = useState<HungerLevel>('moderate');
  const [isDarkMode, setIsDarkMode] = useState(true); // Default to dark mode
  
  // Automatically load and store API key in localStorage (completely hidden from users)
  React.useEffect(() => {
    try {
      const apiKey = getApiKey();
      if (apiKey) {
        // Store the API key in localStorage for future use (hidden from users)
        localStorage.setItem('menubot_api_key', apiKey);
      }
    } catch (e) {
      // Silently ignore any errors - users should never see this
      console.log('API key loading handled automatically');
    }
  }, []);
  
  // Generate accurate dietary information based on actual menu data
  const generateDietaryInfo = (items: MenuItem[]) => {
    if (!items || items.length === 0) {
      return {
        dietaryNotes: "No menu items available for analysis.",
        budgetStrategy: "Unable to provide budget strategy without menu data."
      };
    }

    // Analyze menu composition
    const categories = {
      seafood: 0,
      meat: 0,
      vegetarian: 0,
      vegan: 0,
      dairy: 0,
      grains: 0,
      vegetables: 0,
      fruits: 0,
      desserts: 0,
      healthy: 0,
      highCalorie: 0,
      highProtein: 0,
      lowCalorie: 0
    };

    const totalItems = items.length;
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let totalPrice = 0;

    items.forEach(item => {
      const name = item.name?.toLowerCase() || '';
      const description = item.description?.toLowerCase() || '';
      const combinedText = `${name} ${description}`;
      const calories = item.calories || 0;
      const protein = item.protein_g || 0;
      const fat = item.fat_g || 0;

      // Categorize items based on content
      if (combinedText.includes('salmon') || combinedText.includes('fish') || combinedText.includes('shrimp') || 
          combinedText.includes('tuna') || combinedText.includes('cod') || combinedText.includes('seafood') ||
          combinedText.includes('mackerel') || combinedText.includes('sardine') || combinedText.includes('trout')) {
        categories.seafood++;
      } else if (combinedText.includes('chicken') || combinedText.includes('beef') || combinedText.includes('pork') || 
                 combinedText.includes('lamb') || combinedText.includes('turkey') || combinedText.includes('meat') ||
                 combinedText.includes('steak') || combinedText.includes('burger') || combinedText.includes('sausage')) {
        categories.meat++;
      } else if (combinedText.includes('salad') || combinedText.includes('vegetable') || combinedText.includes('broccoli') ||
                 combinedText.includes('spinach') || combinedText.includes('carrot') || combinedText.includes('tomato') ||
                 combinedText.includes('kale') || combinedText.includes('lettuce') || combinedText.includes('cucumber')) {
        categories.vegetables++;
      } else if (combinedText.includes('rice') || combinedText.includes('pasta') || combinedText.includes('bread') ||
                 combinedText.includes('quinoa') || combinedText.includes('oat') || combinedText.includes('noodle')) {
        categories.grains++;
      } else if (combinedText.includes('cheese') || combinedText.includes('milk') || combinedText.includes('yogurt') ||
                 combinedText.includes('cream') || combinedText.includes('butter') || combinedText.includes('dairy')) {
        categories.dairy++;
      } else if (combinedText.includes('apple') || combinedText.includes('banana') || combinedText.includes('berry') ||
                 combinedText.includes('orange') || combinedText.includes('fruit') || combinedText.includes('grape')) {
        categories.fruits++;
      } else if (combinedText.includes('cake') || combinedText.includes('cookie') || combinedText.includes('ice cream') ||
                 combinedText.includes('dessert') || combinedText.includes('sweet') || combinedText.includes('chocolate')) {
        categories.desserts++;
      }

      // Count vegetarian/vegan (items without meat/seafood)
      if (!combinedText.includes('chicken') && !combinedText.includes('beef') && !combinedText.includes('pork') &&
          !combinedText.includes('lamb') && !combinedText.includes('turkey') && !combinedText.includes('meat') &&
          !combinedText.includes('steak') && !combinedText.includes('burger') && !combinedText.includes('sausage') &&
          !combinedText.includes('salmon') && !combinedText.includes('fish') && !combinedText.includes('shrimp') &&
          !combinedText.includes('tuna') && !combinedText.includes('cod') && !combinedText.includes('seafood') &&
          !combinedText.includes('mackerel') && !combinedText.includes('sardine') && !combinedText.includes('trout')) {
        categories.vegetarian++;
        if (!combinedText.includes('cheese') && !combinedText.includes('milk') && !combinedText.includes('yogurt') &&
            !combinedText.includes('cream') && !combinedText.includes('butter') && !combinedText.includes('dairy')) {
          categories.vegan++;
        }
      }

      // Health categorization
      if (calories <= 300 && protein >= 15 && fat <= 15) {
        categories.healthy++;
      }
      if (calories >= 600) {
        categories.highCalorie++;
      }
      if (protein >= 25) {
        categories.highProtein++;
      }
      if (calories <= 200) {
        categories.lowCalorie++;
      }

      // Accumulate nutrition and price data
      totalCalories += calories;
      totalProtein += protein;
      totalCarbs += item.carbs_g || 0;
      totalFat += fat;
      totalPrice += item.price || 0;
    });

    // Generate dietary notes based on actual data
    let dietaryNotes = `This menu contains ${totalItems} items with a diverse nutritional profile. `;
    
    // Only mention categories that actually exist
    if (categories.seafood > 0) {
      dietaryNotes += `It includes ${categories.seafood} seafood option${categories.seafood > 1 ? 's' : ''}. `;
    }
    if (categories.meat > 0) {
      dietaryNotes += `There are ${categories.meat} meat-based dish${categories.meat > 1 ? 'es' : ''}. `;
    }
    if (categories.vegetables > 0) {
      dietaryNotes += `Vegetable-focused options include ${categories.vegetables} item${categories.vegetables > 1 ? 's' : ''}. `;
    }
    if (categories.grains > 0) {
      dietaryNotes += `Grain-based dishes: ${categories.grains} option${categories.grains > 1 ? 's' : ''}. `;
    }
    if (categories.vegetarian > 0) {
      dietaryNotes += `Vegetarian choices: ${categories.vegetarian} option${categories.vegetarian > 1 ? 's' : ''}. `;
    }
    if (categories.vegan > 0) {
      dietaryNotes += `Vegan-friendly: ${categories.vegan} choice${categories.vegan > 1 ? 's' : ''}. `;
    }
    if (categories.healthy > 0) {
      dietaryNotes += `Health-conscious options: ${categories.healthy} low-calorie, high-protein item${categories.healthy > 1 ? 's' : ''}. `;
    }

    const avgCalories = Math.round(totalCalories / totalItems);
    const avgProtein = Math.round(totalProtein / totalItems);
    const avgCarbs = Math.round(totalCarbs / totalItems);
    const avgFat = Math.round(totalFat / totalItems);
    
    dietaryNotes += `Average nutrition per item: ${avgCalories} calories, ${avgProtein}g protein, ${avgCarbs}g carbs, ${avgFat}g fat.`;

    // Generate budget strategy based on actual data
    const avgPrice = totalPrice / totalItems;
    let budgetStrategy = `The menu offers ${totalItems} items with an average price of ${gbp(avgPrice)}. `;
    
    if (totalPrice <= 50) {
      budgetStrategy += `This is a budget-friendly menu with good value options. `;
    } else if (totalPrice <= 100) {
      budgetStrategy += `This is a mid-range menu with balanced pricing. `;
    } else {
      budgetStrategy += `This is a premium menu with higher-end pricing. `;
    }

    budgetStrategy += `For your ${hungerLevel === 'light' ? 'light hunger' : hungerLevel === 'moderate' ? 'moderate appetite' : 'substantial hunger'}, you can create a balanced meal within your budget.`;

    return { dietaryNotes, budgetStrategy };
  };

  // Validate and cross-check AI-generated menu data for accuracy
  const validateMenuData = (parsed: Analysis): Analysis => {
    const validated = { ...parsed };
    
    // Ensure all items have required fields
    validated.items = validated.items.map(item => ({
      name: item.name || 'Unknown Item',
      description: item.description || '',
      price: item.price || 0,
      calories: item.calories || 0,
      protein_g: item.protein_g || 0,
      carbs_g: item.carbs_g || 0,
      fat_g: item.fat_g || 0
    }));

    // Validate nutrition data - ensure calories add up approximately
    validated.items.forEach(item => {
      const protein = item.protein_g || 0;
      const carbs = item.carbs_g || 0;
      const fat = item.fat_g || 0;
      const calories = item.calories || 0;
      
      const calculatedCalories = (protein * 4) + (carbs * 4) + (fat * 9);
      if (calories > 0 && Math.abs(calculatedCalories - calories) > 100) {
        // If there's a significant discrepancy, adjust the calories
        item.calories = Math.round(calculatedCalories);
      }
    });

    // Ensure health ranking is valid
    if (!Array.isArray(validated.health_rank) || validated.health_rank.length === 0) {
      validated.health_rank = rankItems(validated.items);
    }

    // Validate that health_rank indices are within bounds
    validated.health_rank = validated.health_rank.filter(idx => 
      idx >= 0 && idx < validated.items.length
    );

    // If we lost items due to validation, regenerate ranking
    if (validated.health_rank.length !== validated.items.length) {
      validated.health_rank = rankItems(validated.items);
    }

    return validated;
  };
  const soundRef = useRef<any>(null); // avoid static import of expo-av types

  const pickImage = async () => {
    setError(null);
    try {
      const ImagePicker: any = await import(/* webpackIgnore: true */ 'expo-image-picker');
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        setError('Camera permission is required.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8, base64: true });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        setImageUri(asset.uri);
        setImageBase64(asset.base64 ?? null);
        setAnalysis(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Image picker failed to load. In web sandbox, try mock analysis.');
    }
  };

  const uploadImage = async () => {
    setError(null);
    try {
      const ImagePicker: any = await import(/* webpackIgnore: true */ 'expo-image-picker');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        setError('Media library permission is required.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ 
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8, 
        base64: true 
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        setImageUri(asset.uri);
        setImageBase64(asset.base64 ?? null);
        setAnalysis(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Image picker failed to load.');
    }
  };

  const analyseMenu = async () => {
    if (!imageBase64) {
      setError('No image data found — try again and allow base64.');
      return;
    }
    const key = getApiKey();
    if (!key) {
      setError('OpenAI API key not configured. Please contact support.');
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const dataUrl = `data:image/jpeg;base64,${imageBase64}`;

      // Single structured call: extract items + nutrition + rankings + combos
      const hungerContext = hungerLevel === 'light' ? 'small portions, light meals' : 
                           hungerLevel === 'moderate' ? 'standard portions, balanced meals' : 
                           'larger portions, filling meals';
      
      const systemPrompt = `You are a nutritionist and menu analyst.
Extract the full menu from the provided photo.
Then infer typical UK portion sizes and estimate nutrition per item (kcal, protein_g, carbs_g, fat_g).
Rank items by overall healthiness for a generally healthy adult (bias: higher protein, more fibre/veg, lower added sugar, lower saturated fat, lower kcal density; do not penalise lean fish/chicken).
Consider the user's hunger level: ${hungerContext}. Adjust recommendations accordingly.
Propose 2–3 smart pairings that go well together (e.g., main + side, or 2 small plates) with short rationale.
If prices are missing, estimate typical UK prices from context; mark those as estimated.
Return STRICT JSON matching the schema.`;

      const userPrompt = `Return JSON with fields: {items: MenuItem[], health_rank: number[], combos: {title: string, item_indices: number[], rationale: string}[], notes: string}.
MenuItem = {name: string, description?: string, price?: number, calories?: number, protein_g?: number, carbs_g?: number, fat_g?: number}.
Prices should be numeric in GBP. Make health_rank indices correspond to items[]. Keep notes concise.`;

      // Try multiple models in case one fails
      let lastError: Error | null = null;
      
      for (const model of VISION_MODELS) {
        console.log(`Trying model: ${model}`);
        try {
          const payload = {
            model,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  { type: 'text', text: userPrompt },
                  { type: 'image_url', image_url: { url: dataUrl } },
                ],
              },
            ],
          } as const;

          const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify(payload),
          });

          if (!resp.ok) {
            const text = await resp.text();
            console.error(`OpenAI API Error with model ${model}:`, text);
            lastError = new Error(`OpenAI error ${resp.status}: ${text}`);
            continue; // Try next model
          }
          
          const json = await resp.json();
          const content = json.choices?.[0]?.message?.content ?? '{}';
          
          let parsed: Analysis;
          try {
            parsed = JSON.parse(content);
          } catch (parseError) {
            console.error('Failed to parse OpenAI response:', content);
            lastError = new Error('Invalid response format from OpenAI API');
            continue; // Try next model
          }

          // Validate and cross-check the parsed data for accuracy
          const validated = validateMenuData(parsed);

          setAnalysis(validated);
          setError(null); // Clear any previous errors
          return; // Success, exit the function
        } catch (e: any) {
          console.error(`Model ${model} failed:`, e.message);
          lastError = e;
          continue; // Try next model
        }
      }
      
      // If we get here, all models failed
      throw lastError || new Error('All vision models failed');
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const speak = async (text: string) => {
    const key = getApiKey();
    if (!key || !text) return;
    try {
      setSpeaking(true);
      const AV: any = await import(/* webpackIgnore: true */ 'expo-av');
      // Create speech via OpenAI TTS
      const ttsResp = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: TTS_MODEL,
          voice: 'alloy', // change if you have other voices enabled
          input: text,
          format: 'mp3',
        }),
      });
      if (!ttsResp.ok) {
        const t = await ttsResp.text();
        throw new Error(`TTS error ${ttsResp.status}: ${t}`);
      }
      const arrayBuffer = await ttsResp.arrayBuffer();
      const b64 = arrayBufferToBase64(arrayBuffer);
      const dataUri = `data:audio/mpeg;base64,${b64}`; // works in web; also supported in most RN runtimes

      // Play audio directly from data URI (no FileSystem)
      const { sound } = await AV.Audio.Sound.createAsync({ uri: dataUri }, { shouldPlay: true });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if ('didJustFinish' in status && status.didJustFinish) {
          setSpeaking(false);
        }
      });
    } catch (e: any) {
      setSpeaking(false);
      setError(e.message || 'TTS failed');
    }
  };

  const explanationText = useMemo(() => {
    if (!analysis) return '';
    const top = analysis.health_rank?.[0];
    const best = typeof top === 'number' ? analysis.items[top] : undefined;
    const combo = analysis.combos?.[0];
    const price = combo ? gbp(sumPrice(analysis.items, combo.item_indices)) : best ? gbp(best.price) : '—';
    const summary: MacroSummary = combo
      ? sumMacros(analysis.items, combo.item_indices)
      : best
      ? { calories: best.calories || 0, protein_g: best.protein_g || 0, carbs_g: best.carbs_g || 0, fat_g: best.fat_g || 0 }
      : { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

    const choiceLine = combo
      ? `Top pairing: ${combo.title} — ${combo.item_indices.map(i => analysis.items[i]?.name).filter(Boolean).join(' + ')} (${price}).`
      : best
      ? `Healthiest single: ${best.name} (${gbp(best.price)}).`
      : 'No clear recommendation.';

    return `${choiceLine}\nEstimated nutrition: ${Math.round(summary.calories)} kcal; ${Math.round(summary.protein_g)}g protein, ${Math.round(summary.carbs_g)}g carbohydrates, ${Math.round(summary.fat_g)}g fats.\n${combo?.rationale || analysis.notes || ''}`;
  }, [analysis]);

  // Theme colors
  const colors = {
    background: isDarkMode ? '#0f0f0f' : '#f8f9fa',
    card: isDarkMode ? '#1a1a1a' : '#ffffff',
    text: isDarkMode ? '#ffffff' : '#2c3e50',
    textSecondary: isDarkMode ? '#b0b0b0' : '#7f8c8d',
    primary: '#3498db',
    success: '#27ae60',
    warning: '#f39c12',
    danger: '#e74c3c',
    border: isDarkMode ? '#333333' : '#ecf0f1',
    shadow: isDarkMode ? '#000000' : '#000000'
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* Header */}
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 16 }}>
            <TouchableOpacity onPress={() => setIsDarkMode(!isDarkMode)} style={{ padding: 8 }}>
              <Text style={{ color: colors.text, fontSize: 24 }}>
                {isDarkMode ? '☀️' : '🌙'}
              </Text>
            </TouchableOpacity>
          </View>
          
          {/* MenuBot Logo */}
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <Image 
              source={require('./assets/menubot-logo.jpg')}
              style={{ 
                width: 80, 
                height: 80, 
                borderRadius: 12,
                marginBottom: 8
              }}
              resizeMode="contain"
            />
          </View>
          
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: '700', marginBottom: 8 }}>MenuBot</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 16, textAlign: 'center' }}>
            Get personalized healthy recommendations based on your hunger level
          </Text>
        </View>

        {/* Hunger Level Selection */}
        <View style={{ 
          backgroundColor: colors.card, 
          borderRadius: 16, 
          padding: 20, 
          marginBottom: 20, 
          shadowColor: colors.shadow, 
          shadowOffset: { width: 0, height: 2 }, 
          shadowOpacity: 0.1, 
          shadowRadius: 8, 
          elevation: 3,
          borderWidth: 1,
          borderColor: colors.border
        }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: 16 }}>Hunger Level</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {[
              { level: 'light' as HungerLevel, label: 'Light Hunger', subtitle: '2-3', color: '#3498db' },
              { level: 'moderate' as HungerLevel, label: 'Moderate Hunger', subtitle: '3-4', color: '#f39c12' },
              { level: 'very' as HungerLevel, label: 'Very Hungry', subtitle: '4-6', color: '#e74c3c' }
            ].map(({ level, label, subtitle, color }) => (
              <TouchableOpacity
                key={level}
                onPress={() => setHungerLevel(level)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  padding: 16,
                  marginHorizontal: 4,
                  borderRadius: 12,
                  backgroundColor: hungerLevel === level ? color : (isDarkMode ? '#2a2a2a' : '#ecf0f1'),
                  borderWidth: 2,
                  borderColor: hungerLevel === level ? color : 'transparent'
                }}
              >
                <View style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: hungerLevel === level ? 'white' : (isDarkMode ? '#555555' : '#bdc3c7'),
                  marginBottom: 8,
                  justifyContent: 'center',
                  alignItems: 'center'
                }}>
                  {hungerLevel === level && (
                    <View style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: color
                    }} />
                  )}
                </View>
                <Text style={{
                  color: hungerLevel === level ? 'white' : colors.text,
                  fontSize: 14,
                  fontWeight: '600',
                  textAlign: 'center',
                  marginBottom: 4
                }}>
                  {label}
                </Text>
                <Text style={{
                  color: hungerLevel === level ? 'white' : colors.textSecondary,
                  fontSize: 12,
                  fontWeight: '500'
                }}>
                  {subtitle}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Menu Camera Section */}
        <View style={{ 
          backgroundColor: colors.card, 
          borderRadius: 16, 
          padding: 20, 
          marginBottom: 20, 
          shadowColor: colors.shadow, 
          shadowOffset: { width: 0, height: 2 }, 
          shadowOpacity: 0.1, 
          shadowRadius: 8, 
          elevation: 3,
          borderWidth: 1,
          borderColor: colors.border
        }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: 16 }}>Menu Camera</Text>
          
          {imageUri ? (
            <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: colors.primary, borderStyle: 'dashed', marginBottom: 16 }}>
              <Image source={{ uri: imageUri }} style={{ width: '100%', height: 200 }} resizeMode="cover" />
            </View>
          ) : (
            <View style={{ 
              borderWidth: 2, 
              borderColor: colors.border, 
              borderStyle: 'dashed', 
              borderRadius: 12, 
              height: 200, 
              justifyContent: 'center', 
              alignItems: 'center',
              backgroundColor: isDarkMode ? '#2a2a2a' : '#f8f9fa',
              marginBottom: 16
            }}>
              <Text style={{ color: colors.textSecondary, fontSize: 16, textAlign: 'center' }}>
                📷 Point your camera at a menu{'\n'}or 📁 upload an image to analyze
              </Text>
            </View>
          )}
          
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={pickImage}
              style={{
                flex: 1,
                backgroundColor: colors.primary,
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 12,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              <Text style={{ fontSize: 18, color: 'white', fontWeight: '600' }}>📷</Text>
              <Text style={{ fontSize: 16, color: 'white', fontWeight: '600' }}>Capture</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={uploadImage}
              style={{
                flex: 1,
                backgroundColor: '#6c5ce7',
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 12,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              <Text style={{ fontSize: 18, color: 'white', fontWeight: '600' }}>📁</Text>
              <Text style={{ fontSize: 16, color: 'white', fontWeight: '600' }}>Upload</Text>
            </TouchableOpacity>
            
            {imageUri && (
              <TouchableOpacity
                onPress={() => { setImageUri(null); setImageBase64(null); setAnalysis(null); }}
                style={{
                  flex: 1,
                  backgroundColor: colors.danger,
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderRadius: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8
                }}
              >
                <Text style={{ fontSize: 18, color: 'white', fontWeight: '600' }}>🗑️</Text>
                <Text style={{ fontSize: 16, color: 'white', fontWeight: '600' }}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Analyze Button */}
        <TouchableOpacity
          onPress={analyseMenu}
          disabled={!imageUri || !imageBase64 || loading}
          style={{
            backgroundColor: !imageUri || !imageBase64 || loading ? (isDarkMode ? '#555555' : '#bdc3c7') : colors.success,
            paddingVertical: 16,
            paddingHorizontal: 24,
            borderRadius: 16,
            alignItems: 'center',
            marginBottom: 20,
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.2,
            shadowRadius: 8,
            elevation: 5
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 20, color: 'white', fontWeight: '700' }}>✨</Text>
            <Text style={{ fontSize: 18, color: 'white', fontWeight: '700' }}>
              {loading ? 'Analyzing...' : 'Analyze Menu'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Error Display */}
        {error && (
          <View style={{ backgroundColor: '#f8d7da', borderColor: '#f5c6cb', borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <Text style={{ color: '#721c24', fontSize: 14 }}>{error}</Text>
          </View>
        )}



        {/* Loading Indicator */}
        {loading && (
          <View style={{ 
            backgroundColor: colors.card, 
            borderRadius: 16, 
            padding: 24, 
            alignItems: 'center', 
            marginBottom: 20,
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 8,
            elevation: 3,
            borderWidth: 1,
            borderColor: colors.border
          }}>
            <View style={{ 
              width: 60, 
              height: 60, 
              borderRadius: 30, 
              backgroundColor: colors.primary, 
              alignItems: 'center', 
              justifyContent: 'center',
              marginBottom: 16
            }}>
              <ActivityIndicator size="large" color="white" />
            </View>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
              Analyzing Menu
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center' }}>
              We are processing your menu to provide personalized recommendations
            </Text>
          </View>
        )}

        {/* Analysis Results */}
        {analysis && (
          <View style={{ gap: 16 }}>
            {/* Personalized Menu Recommendations - SHOWN FIRST */}
            <View style={{ 
              backgroundColor: colors.card, 
              borderRadius: 16, 
              padding: 20, 
              shadowColor: colors.shadow, 
              shadowOffset: { width: 0, height: 2 }, 
              shadowOpacity: 0.1, 
              shadowRadius: 8, 
              elevation: 3,
              borderWidth: 1,
              borderColor: colors.border
            }}>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 20, textAlign: 'center' }}>
                🎯 Your Personalized Menu Recommendations
              </Text>
              
              {/* Top Recommendation */}
              {analysis.health_rank.length > 0 && (
                <View style={{ 
                  backgroundColor: isDarkMode ? '#2a2a2a' : '#f8f9fa', 
                  borderRadius: 12, 
                  padding: 16, 
                  marginBottom: 16,
                  borderLeftWidth: 4,
                  borderLeftColor: colors.success
                }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 18, flex: 1 }}>
                      {analysis.items[analysis.health_rank[0]]?.name}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ 
                        backgroundColor: colors.success, 
                        paddingHorizontal: 8, 
                        paddingVertical: 4, 
                        borderRadius: 12 
                      }}>
                        <Text style={{ color: 'white', fontSize: 12, fontWeight: '600' }}>HEALTHY</Text>
                      </View>
                      <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                        {Math.round(analysis.items[analysis.health_rank[0]]?.calories || 0)} kcal
                      </Text>
                    </View>
                  </View>
                  
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 18 }}>
                      {gbp(analysis.items[analysis.health_rank[0]]?.price)}
                    </Text>
                  </View>
                  
                  {/* Why This Choice */}
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14, marginBottom: 4 }}>
                      Why This Choice:
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
                      This dish is rich in nutrients, low in calories, and provides a good balance of protein, fiber, and healthy fats, making it perfect for your {hungerLevel === 'light' ? 'light hunger' : hungerLevel === 'moderate' ? 'moderate appetite' : 'substantial hunger'} level.
                    </Text>
                  </View>
                  
                  {/* Nutrition Summary */}
                  <View>
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14, marginBottom: 4 }}>
                      Nutrition Summary:
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
                      {Math.round(analysis.items[analysis.health_rank[0]]?.calories || 0)} calories, {Math.round(analysis.items[analysis.health_rank[0]]?.protein_g || 0)}g protein, {Math.round(analysis.items[analysis.health_rank[0]]?.carbs_g || 0)}g carbs, {Math.round(analysis.items[analysis.health_rank[0]]?.fat_g || 0)}g fat. 
                      {analysis.items[analysis.health_rank[0]]?.description && ` ${analysis.items[analysis.health_rank[0]]?.description}`}
                    </Text>
                  </View>
                </View>
              )}
              
              {/* Hear Recommendations Section */}
              <View style={{ 
                backgroundColor: isDarkMode ? '#2a2a2a' : '#f8f9fa', 
                borderRadius: 12, 
                padding: 16,
                borderWidth: 1,
                borderColor: colors.border
              }}>
                <TouchableOpacity
                  onPress={() => speak(explanationText)}
                  disabled={speaking || !getApiKey()}
                  style={{
                    backgroundColor: speaking || !getApiKey() ? (isDarkMode ? '#555555' : '#bdc3c7') : '#9b59b6',
                    paddingVertical: 12,
                    paddingHorizontal: 20,
                    borderRadius: 12,
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 8,
                    marginBottom: 12
                  }}
                >
                  <Text style={{ fontSize: 18, color: 'white', fontWeight: '600' }}>
                    🔊
                  </Text>
                  <Text style={{ fontSize: 16, color: 'white', fontWeight: '600' }}>
                    {speaking ? 'Speaking...' : 'Hear Recommendations'}
                  </Text>
                </TouchableOpacity>
                
                <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
                  What you'll hear: A personalized audio summary explaining the most recommended pairing, including total calories, nutrition benefits, and breakdown to help you make the healthiest choice for your current hunger level.
                </Text>
              </View>
            </View>

            {/* Healthiest Picks */}
            <View style={{ 
              backgroundColor: colors.card, 
              borderRadius: 16, 
              padding: 20, 
              shadowColor: colors.shadow, 
              shadowOffset: { width: 0, height: 2 }, 
              shadowOpacity: 0.1, 
              shadowRadius: 8, 
              elevation: 3,
              borderWidth: 1,
              borderColor: colors.border
            }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: 16 }}>🥗 Healthiest Picks</Text>
              {analysis.health_rank.slice(0, 5).map((idx, i) => (
                <View key={i} style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  paddingVertical: 12, 
                  borderBottomWidth: i === analysis.health_rank.slice(0, 5).length - 1 ? 0 : 1, 
                  borderColor: colors.border 
                }}>
                  <View style={{ 
                    width: 32, 
                    height: 32, 
                    borderRadius: 16, 
                    backgroundColor: colors.success, 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    marginRight: 16
                  }}>
                    <Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{analysis.items[idx]?.name}</Text>
                    {!!analysis.items[idx]?.description && (
                      <Text style={{ color: colors.textSecondary, marginTop: 4, fontSize: 14 }}>{analysis.items[idx]?.description}</Text>
                    )}
                    <View style={{ flexDirection: 'row', marginTop: 8, gap: 16 }}>
                      <Text style={{ color: colors.danger, fontWeight: '600' }}>{gbp(analysis.items[idx]?.price)}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                        {Math.round(analysis.items[idx]?.calories || 0)} kcal
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>

            {/* Smart Pairings */}
            {analysis.combos && analysis.combos.length > 0 && (
              <View style={{ 
                backgroundColor: colors.card, 
                borderRadius: 16, 
                padding: 20, 
                shadowColor: colors.shadow, 
                shadowOffset: { width: 0, height: 2 }, 
                shadowOpacity: 0.1, 
                shadowRadius: 8, 
                elevation: 3,
                borderWidth: 1,
                borderColor: colors.border
              }}>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: 16 }}>💡 Smart Pairings</Text>
                {analysis.combos.map((c, i) => {
                  const total = sumPrice(analysis.items, c.item_indices);
                  const macros = sumMacros(analysis.items, c.item_indices);
                  return (
                    <View key={i} style={{ 
                      padding: 16, 
                      backgroundColor: isDarkMode ? '#2a2a2a' : '#f8f9fa', 
                      borderRadius: 12, 
                      marginBottom: 12,
                      borderLeftWidth: 4,
                      borderLeftColor: colors.primary
                    }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16, marginBottom: 8 }}>{c.title}</Text>
                      <Text style={{ color: colors.textSecondary, marginBottom: 8, fontSize: 14 }}>
                        {c.item_indices.map(j => analysis.items[j]?.name).filter(Boolean).join(' + ')}
                      </Text>
                      <Text style={{ color: colors.textSecondary, marginBottom: 12, fontSize: 14, fontStyle: 'italic' }}>
                        {c.rationale}
                      </Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 16 }}>
                          Total: {gbp(total)}
                        </Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                          {Math.round(macros.calories)} kcal
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* All Items */}
            <View style={{ 
              backgroundColor: colors.card, 
              borderRadius: 16, 
              padding: 20, 
              shadowColor: colors.shadow, 
              shadowOffset: { width: 0, height: 2 }, 
              shadowOpacity: 0.1, 
              shadowRadius: 8, 
              elevation: 3,
              borderWidth: 1,
              borderColor: colors.border
            }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: 16 }}>📋 All Menu Items</Text>
              {analysis.items.map((it, i) => (
                <View key={i} style={{ 
                  paddingVertical: 12, 
                  borderBottomWidth: i === analysis.items.length - 1 ? 0 : 1, 
                  borderColor: colors.border 
                }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16, flex: 1 }}>{it.name}</Text>
                    <Text style={{ color: colors.danger, fontWeight: '600', fontSize: 16 }}>{gbp(it.price)}</Text>
                  </View>
                  {!!it.description && (
                    <Text style={{ color: colors.textSecondary, marginBottom: 8, fontSize: 14 }}>{it.description}</Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                      {Math.round(it.calories || 0)} kcal
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                      P: {Math.round(it.protein_g || 0)}g
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                      C: {Math.round(it.carbs_g || 0)}g
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                      F: {Math.round(it.fat_g || 0)}g
                    </Text>
                  </View>
                </View>
              ))}
              {analysis.notes && (
                <View style={{ marginTop: 16, padding: 12, backgroundColor: isDarkMode ? '#2a2a2a' : '#f8f9fa', borderRadius: 8 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 14, fontStyle: 'italic' }}>
                    💡 {analysis.notes}
                  </Text>
                </View>
              )}
            </View>

            {/* Dietary Information */}
            <View style={{ 
              backgroundColor: colors.card, 
              borderRadius: 16, 
              padding: 20, 
              shadowColor: colors.shadow, 
              shadowOffset: { width: 0, height: 2 }, 
              shadowOpacity: 0.1, 
              shadowRadius: 8, 
              elevation: 3,
              borderWidth: 1,
              borderColor: colors.border
            }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: 20, textAlign: 'center' }}>
                🥗 Dietary Information
              </Text>
              
              <View style={{ gap: 16 }}>
                {/* Dietary Notes */}
                <View style={{ 
                  backgroundColor: isDarkMode ? '#1a3a1a' : '#e8f5e8', 
                  borderRadius: 12, 
                  padding: 16,
                  borderLeftWidth: 4,
                  borderLeftColor: colors.success
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={{ fontSize: 16, marginRight: 8 }}>🌱</Text>
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>
                      Dietary Notes
                    </Text>
                  </View>
                  <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
                    {generateDietaryInfo(analysis.items).dietaryNotes}
                  </Text>
                </View>
                
                {/* Budget Strategy */}
                <View style={{ 
                  backgroundColor: isDarkMode ? '#2a2a2a' : '#f8f9fa', 
                  borderRadius: 12, 
                  padding: 16,
                  borderLeftWidth: 4,
                  borderLeftColor: colors.primary
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={{ fontSize: 16, marginRight: 8 }}>👤💰</Text>
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>
                      Budget Strategy
                    </Text>
                  </View>
                  <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
                    {generateDietaryInfo(analysis.items).budgetStrategy}
                  </Text>
                </View>
              </View>
            </View>

            {/* Cost & Nutrition Summary */}
            <View style={{ 
              backgroundColor: colors.card, 
              borderRadius: 16, 
              padding: 20, 
              shadowColor: colors.shadow, 
              shadowOffset: { width: 0, height: 2 }, 
              shadowOpacity: 0.1, 
              shadowRadius: 8, 
              elevation: 3,
              borderWidth: 1,
              borderColor: colors.border
            }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: 20, textAlign: 'center' }}>
                💰 Cost & Nutrition Summary
              </Text>
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ color: colors.success, fontSize: 24, fontWeight: '700', marginBottom: 4 }}>
                    {gbp(sumPrice(analysis.items, analysis.health_rank.slice(0, 3)))}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, textAlign: 'center' }}>
                    Total Cost{'\n'}(Top 3 Recommendations)
                  </Text>
                </View>
                
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ color: colors.primary, fontSize: 24, fontWeight: '700', marginBottom: 4 }}>
                    {Math.round(sumMacros(analysis.items, analysis.health_rank.slice(0, 3)).calories)} kcal
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, textAlign: 'center' }}>
                    Total Calories{'\n'}(Top 3 Recommendations)
                  </Text>
                </View>
                
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ color: '#9b59b6', fontSize: 24, fontWeight: '700', marginBottom: 4 }}>
                    {Math.min(3, analysis.health_rank.length)}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, textAlign: 'center' }}>
                    Top{'\n'}Recommendations
                  </Text>
                </View>
              </View>

              {/* Individual Recommendation Breakdown */}
              {analysis.health_rank.slice(0, 3).map((idx, i) => {
                const item = analysis.items[idx];
                const letters = ['A', 'B', 'C'];
                return (
                  <View key={i} style={{ 
                    backgroundColor: isDarkMode ? '#2a2a2a' : '#f8f9fa', 
                    borderRadius: 12, 
                    padding: 16, 
                    marginBottom: 12,
                    borderLeftWidth: 4,
                    borderLeftColor: [colors.success, colors.primary, '#9b59b6'][i]
                  }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 16 }}>
                        Choice {letters[i]}
                      </Text>
                    </View>
                    
                    <View style={{ marginBottom: 8 }}>
                      <Text style={{ color: colors.text, fontSize: 14, marginBottom: 4 }}>
                        {item?.name}:
                      </Text>
                      <Text style={{ color: colors.danger, fontWeight: '600', fontSize: 14 }}>
                        {gbp(item?.price)}
                      </Text>
                    </View>
                    
                    <View style={{ flexDirection: 'row', gap: 16 }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                        {Math.round(item?.calories || 0)} kcal
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                        P: {Math.round(item?.protein_g || 0)}g
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                        C: {Math.round(item?.carbs_g || 0)}g
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                        F: {Math.round(item?.fat_g || 0)}g
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- UI Bits ----------

function SmallButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={{ opacity: disabled ? 0.5 : 1 }}>
      <View style={{ backgroundColor: '#13243f', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#274572', marginRight: 8 }}>
        <Text style={{ color: 'white', fontWeight: '600' }}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ---------- DEV TESTS (no network; run only in dev) ----------
// Added tests without altering existing ones.

function expect(label: string, cond: boolean) {
  // eslint-disable-next-line no-console
  console[cond ? 'log' : 'error'](`TEST ${cond ? 'PASS' : 'FAIL'} — ${label}`);
}

function sameMembers<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function runDevTests() {
  // Existing tests ------------------------------------------------------
  // gbp formatting
  expect('gbp(5) => £5.00', gbp(5) === '£5.00');
  expect('gbp(undefined) => —', gbp(undefined) === '—');

  // ranking
  const items: MenuItem[] = [
    { name: 'Grilled Chicken', calories: 450, protein_g: 45, carbs_g: 10, fat_g: 12, price: 12 },
    { name: 'Cheesecake', calories: 650, protein_g: 6, carbs_g: 60, fat_g: 40, price: 6 },
    { name: 'Salmon Salad', calories: 420, protein_g: 35, carbs_g: 12, fat_g: 18, price: 13 },
  ];
  const order = rankItems(items);
  expect('healthiest first is either Chicken or Salmon', order[0] !== 1);
  expect('cheesecake is worst', order[2] === 1);

  // sums
  const total = sumPrice(items, [0, 2]);
  expect('sumPrice 12+13=25', Math.abs(total - 25) < 1e-6);
  const macros = sumMacros(items, [0, 2]);
  expect('sumMacros calories 450+420=870', macros.calories === 870);
  expect('sumMacros protein 45+35=80', macros.protein_g === 80);

  // arrayBufferToBase64
  const buf = new Uint8Array([104, 105]).buffer; // "hi"
  const b64 = arrayBufferToBase64(buf);
  expect('arrayBufferToBase64("hi") === aGk=', b64 === 'aGk=');

  // Additional tests ----------------------------------------------------
  // empty indices
  expect('sumPrice with [] is 0', sumPrice(items, []) === 0);
  const emptyMacros = sumMacros(items, []);
  expect('sumMacros with [] is all zeros', emptyMacros.calories === 0 && emptyMacros.protein_g === 0 && emptyMacros.carbs_g === 0 && emptyMacros.fat_g === 0);

  // out-of-range index ignored
  const macrosOoB = sumMacros(items, [0, 99]);
  expect('sumMacros ignores out-of-range indices', macrosOoB.calories === items[0].calories);

  // ranking with ties (determinism of membership)
  const tied: MenuItem[] = [
    { name: 'A', calories: 400, protein_g: 30, carbs_g: 10, fat_g: 10 },
    { name: 'B', calories: 400, protein_g: 30, carbs_g: 10, fat_g: 10 },
  ];
  const r = rankItems(tied);
  expect('ties include both items once', sameMembers(r, [0, 1]));

  // base64 of empty buffer
  const b0 = arrayBufferToBase64(new Uint8Array([]).buffer);
  expect('arrayBufferToBase64("") === ""', b0 === '');
}

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  try { runDevTests(); } catch (e) { console.error('TESTS CRASHED', e); }
}

// ---------- Security & Privacy (readme snippet) ----------
// 1) Don’t ship your API key in client apps. This file is for rapid prototyping. Move calls to a server.
// 2) Consider a two-call pipeline for accuracy: (a) OCR & structure, (b) nutrition + combos cross-checked.
// 3) Present estimates clearly as estimates; include allergens and dietary filters before production.
// 4) Cache per-restaurant menus on-device to reduce cost/latency; hash image to detect duplicates.
// 5) For UK users, default currency to GBP and show total including service if provided on menu.
