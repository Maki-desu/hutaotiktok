import { useState, useEffect } from "react";
import chibi1 from "@/assets/chibi1.png";
import chibi2 from "@/assets/chibi2.png";
import chibi3 from "@/assets/chibi3.png";
import { loadBounceAnimationEnabled, onBounceAnimationChanged } from "@/lib/bounce-animation";

interface ChibiItem {
  id: number;
  src: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  isClicked: boolean;
}

const CHIBI_IMAGES = [chibi1, chibi2, chibi3];

export function ChibiWanderers() {
  const [bounceEnabled, setBounceEnabled] = useState(() => loadBounceAnimationEnabled());
  const [chibis, setChibis] = useState<ChibiItem[]>(() => {
    return CHIBI_IMAGES.map((src, i) => ({
      id: i,
      src,
      x: 10 + i * 32, // distributed starting percentage across screen
      y: 65 + (i % 2) * 15,
      scale: 1,
      rotation: (i % 2 === 0 ? 1 : -1) * 6,
      isClicked: false,
    }));
  });

  useEffect(() => {
    // Wander around randomly every 4 seconds
    const interval = setInterval(() => {
      setChibis((prev) =>
        prev.map((c) => {
          if (c.isClicked) return c;
          // Random new target coordinate bounded within view padding
          const newX = Math.max(5, Math.min(80, c.x + (Math.random() * 24 - 12)));
          const newY = Math.max(15, Math.min(82, c.y + (Math.random() * 20 - 10)));
          const newRot = (Math.random() * 16 - 8);
          return {
            ...c,
            x: newX,
            y: newY,
            rotation: newRot,
          };
        })
      );
    }, 4000);

    const unsubscribeBounce = onBounceAnimationChanged(setBounceEnabled);
    return () => {
      clearInterval(interval);
      unsubscribeBounce();
    };
  }, []);

  const handleChibiTap = (id: number) => {
    setChibis((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          return { ...c, isClicked: true, scale: 1.3, rotation: c.rotation + 360 };
        }
        return c;
      })
    );

    setTimeout(() => {
      setChibis((prev) =>
        prev.map((c) => {
          if (c.id === id) {
            return { ...c, isClicked: false, scale: 1 };
          }
          return c;
        })
      );
    }, 800);
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-[80] overflow-hidden select-none">
      {chibis.map((c) => (
        <div
          key={c.id}
          onClick={() => handleChibiTap(c.id)}
          className={`absolute pointer-events-auto cursor-pointer transition-all duration-700 ${
            bounceEnabled
              ? "ease-[cubic-bezier(0.34,1.65,0.64,1)] hover:scale-115 active:scale-85"
              : "ease-out"
          }`}
          style={{
            left: `${c.x}%`,
            top: `${c.y}%`,
            transform: `scale(${c.scale}) rotate(${c.rotation}deg)`,
            filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.4))",
          }}
        >
          <img
            src={c.src}
            alt={`Hu Tao Chibi ${c.id + 1}`}
            className={`w-16 h-16 sm:w-20 sm:h-20 object-contain ${bounceEnabled ? "animate-bounce" : ""}`}
            style={{
              animationDuration: `${2.5 + c.id * 0.6}s`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
