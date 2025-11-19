import React, { useEffect, useRef } from 'react';

interface Props {
  volume: number; // 0-100
  isActive: boolean;
}

export const AudioVisualizer: React.FC<Props> = ({ volume, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      if (!isActive) {
        // Idle state line
        ctx.beginPath();
        ctx.strokeStyle = '#334155'; // slate-700
        ctx.lineWidth = 2;
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        return;
      }

      // Dynamic wave
      const bars = 20;
      const barWidth = width / bars;
      
      ctx.fillStyle = '#4ade80'; // green-400
      
      for (let i = 0; i < bars; i++) {
        // Create a wave effect based on volume and time
        const time = Date.now() / 100;
        const wave = Math.sin(i * 0.5 + time) * 0.5 + 0.5; // 0 to 1
        // Random jitter based on volume
        const jitter = Math.random() * 0.5 + 0.5;
        
        // Height is proportional to volume + wave effect
        const barHeight = Math.max(4, (volume / 100) * height * wave * jitter * 1.5);
        
        const x = i * barWidth + 2;
        const y = (height - barHeight) / 2;
        
        ctx.fillRect(x, y, barWidth - 4, barHeight);
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => cancelAnimationFrame(animationId);
  }, [volume, isActive]);

  return (
    <canvas 
      ref={canvasRef} 
      width={300} 
      height={60} 
      className="w-full h-16 rounded-lg bg-slate-800 border border-slate-700 shadow-inner"
    />
  );
};