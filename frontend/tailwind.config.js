/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  // Enable RTL variant — triggered by dir="rtl" on any ancestor element
  // Works with Tailwind v3 natively; the rtl: prefix reverses directional utilities
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {
      fontFamily: { sans: ['Geist', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'], mono: ['Geist Mono', 'ui-monospace', 'monospace'] },
      colors: {
      // GRC Eye brand kit v1.0 — every Tailwind hue is remapped onto the kit palette:
      // Ink/Paper/Line neutrals, Signal Blue accent, severity scale (green/yellow/orange/red).
      blue: { 50:'#E8F3FC',100:'#D0E6F8',200:'#A6CEF0',300:'#72B0E4',400:'#3F92D6',500:'#2185D3',600:'#0F74C5',700:'#0C5D9E',800:'#0B4A7E',900:'#0A3B63',950:'#062440' },
      indigo: { 50:'#E8F3FC',100:'#D0E6F8',200:'#A6CEF0',300:'#72B0E4',400:'#3F92D6',500:'#2185D3',600:'#0F74C5',700:'#0C5D9E',800:'#0B4A7E',900:'#0A3B63',950:'#062440' },
      sky: { 50:'#E8F3FC',100:'#D0E6F8',200:'#A6CEF0',300:'#72B0E4',400:'#3F92D6',500:'#2185D3',600:'#0F74C5',700:'#0C5D9E',800:'#0B4A7E',900:'#0A3B63',950:'#062440' },
      cyan: { 50:'#E8F3FC',100:'#D0E6F8',200:'#A6CEF0',300:'#72B0E4',400:'#3F92D6',500:'#2185D3',600:'#0F74C5',700:'#0C5D9E',800:'#0B4A7E',900:'#0A3B63',950:'#062440' },
      teal: { 50:'#E8F3FC',100:'#D0E6F8',200:'#A6CEF0',300:'#72B0E4',400:'#3F92D6',500:'#2185D3',600:'#0F74C5',700:'#0C5D9E',800:'#0B4A7E',900:'#0A3B63',950:'#062440' },
      violet: { 50:'#E8F3FC',100:'#D0E6F8',200:'#A6CEF0',300:'#72B0E4',400:'#3F92D6',500:'#2185D3',600:'#0F74C5',700:'#0C5D9E',800:'#0B4A7E',900:'#0A3B63',950:'#062440' },
      purple: { 50:'#E8F3FC',100:'#D0E6F8',200:'#A6CEF0',300:'#72B0E4',400:'#3F92D6',500:'#2185D3',600:'#0F74C5',700:'#0C5D9E',800:'#0B4A7E',900:'#0A3B63',950:'#062440' },
      fuchsia: { 50:'#E8F3FC',100:'#D0E6F8',200:'#A6CEF0',300:'#72B0E4',400:'#3F92D6',500:'#2185D3',600:'#0F74C5',700:'#0C5D9E',800:'#0B4A7E',900:'#0A3B63',950:'#062440' },
      gray: { 50:'#F6F6F4',100:'#ECECE9',200:'#D9DAD6',300:'#C1C3BE',400:'#8E9299',500:'#6B7078',600:'#5B6068',700:'#3D4249',800:'#262A30',900:'#15181C',950:'#0E1013' },
      slate: { 50:'#F6F6F4',100:'#ECECE9',200:'#D9DAD6',300:'#C1C3BE',400:'#8E9299',500:'#6B7078',600:'#5B6068',700:'#3D4249',800:'#262A30',900:'#15181C',950:'#0E1013' },
      zinc: { 50:'#F6F6F4',100:'#ECECE9',200:'#D9DAD6',300:'#C1C3BE',400:'#8E9299',500:'#6B7078',600:'#5B6068',700:'#3D4249',800:'#262A30',900:'#15181C',950:'#0E1013' },
      neutral: { 50:'#F6F6F4',100:'#ECECE9',200:'#D9DAD6',300:'#C1C3BE',400:'#8E9299',500:'#6B7078',600:'#5B6068',700:'#3D4249',800:'#262A30',900:'#15181C',950:'#0E1013' },
      stone: { 50:'#F6F6F4',100:'#ECECE9',200:'#D9DAD6',300:'#C1C3BE',400:'#8E9299',500:'#6B7078',600:'#5B6068',700:'#3D4249',800:'#262A30',900:'#15181C',950:'#0E1013' },
      red: { 50:'#FCF0F0',100:'#F9E1E1',200:'#F3C3C2',300:'#EDA0A0',400:'#E47170',500:'#DB4241',600:'#C23C3B',700:'#9C3232',800:'#772829',900:'#592121',950:'#3E1A1B' },
      rose: { 50:'#FCF0F0',100:'#F9E1E1',200:'#F3C3C2',300:'#EDA0A0',400:'#E47170',500:'#DB4241',600:'#C23C3B',700:'#9C3232',800:'#772829',900:'#592121',950:'#3E1A1B' },
      pink: { 50:'#FCF0F0',100:'#F9E1E1',200:'#F3C3C2',300:'#EDA0A0',400:'#E47170',500:'#DB4241',600:'#C23C3B',700:'#9C3232',800:'#772829',900:'#592121',950:'#3E1A1B' },
      orange: { 50:'#FEF5EE',100:'#FCEBDE',200:'#FAD8BC',300:'#F7C296',400:'#F3A462',500:'#EF852E',600:'#D4762A',700:'#AA6124',800:'#814B1F',900:'#613A1A',950:'#432A16' },
      amber: { 50:'#FDFAF1',100:'#FBF6E3',200:'#F6EDC7',300:'#F2E2A7',400:'#EBD47B',500:'#E4C64F',600:'#AE983F',700:'#827232',800:'#665A29',900:'#504823',950:'#3A351C' },
      yellow: { 50:'#FDFAF1',100:'#FBF6E3',200:'#F6EDC7',300:'#F2E2A7',400:'#EBD47B',500:'#E4C64F',600:'#AE983F',700:'#827232',800:'#665A29',900:'#504823',950:'#3A351C' },
      green: { 50:'#F2FAF4',100:'#E5F4E9',200:'#CBEAD3',300:'#ADDEBA',400:'#84CE97',500:'#5BBD74',600:'#4C9D62',700:'#3E7D4F',800:'#31613F',900:'#264831',950:'#1D3626' },
      emerald: { 50:'#F2FAF4',100:'#E5F4E9',200:'#CBEAD3',300:'#ADDEBA',400:'#84CE97',500:'#5BBD74',600:'#4C9D62',700:'#3E7D4F',800:'#31613F',900:'#264831',950:'#1D3626' },
      lime: { 50:'#F2FAF4',100:'#E5F4E9',200:'#CBEAD3',300:'#ADDEBA',400:'#84CE97',500:'#5BBD74',600:'#4C9D62',700:'#3E7D4F',800:'#31613F',900:'#264831',950:'#1D3626' },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  safelist: [
    "translate-x-full",
    "flex-row-reverse",
  ],
  plugins: [],
};
