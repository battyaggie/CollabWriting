import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        tw: {
          blue: "#00649C",
          "blue-light": "#66A2C4",
          green: "#8BB31D",
          "green-light": "#B9D177",
          grey: "#72777A",
          "grey-light": "#AAADAF",
          navy: "#323F4F",
          bg: "#F4F5F6",
          border: "#ECEDEE",
        },
      },
      fontFamily: {
        display: ["Arial Black", "Arial", "sans-serif"],
        sans: ["Arial", "Helvetica", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
