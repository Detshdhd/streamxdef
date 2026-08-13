import type { Config } from "tailwindcss";

// Minimal config: colors/radii come from the --nfx-* tokens in globals.css,
// not from an HSL shadcn theme. Animations are custom keyframes in globals.css.
const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;
