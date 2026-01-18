import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  barColor?: string;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ 
  analyser, 
  isActive, 
  barColor = '#3b82f6' 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!analyser || !isActive) {
        // Draw a subtle flat line if inactive
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.strokeStyle = '#e5e7eb'; // gray-200
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.stroke();
        return;
      }

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      // Visualizer settings
      const barCount = 32; // Reduce bar count for cleaner look
      const step = Math.floor(bufferLength / barCount);
      const gap = 4;
      const totalGapSpace = gap * (barCount - 1);
      const barWidth = (canvas.width - totalGapSpace) / barCount;
      
      let x = 0;

      for (let i = 0; i < barCount; i++) {
        // Average the frequency data for this step
        let sum = 0;
        for (let j = 0; j < step; j++) {
            sum += dataArray[i * step + j];
        }
        const average = sum / step;
        
        // Scale height (make it responsive but not too jumpy)
        const barHeight = Math.max(4, (average / 255) * canvas.height * 0.8);

        ctx.fillStyle = barColor;
        
        // Center vertically
        const y = (canvas.height - barHeight) / 2;
        
        // Draw rounded bar
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y, barWidth, barHeight, 4);
        } else {
            // Fallback for older browsers
            ctx.rect(x, y, barWidth, barHeight);
        }
        ctx.fill();

        x += barWidth + gap;
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyser, isActive, barColor]);

  return (
    <canvas 
      ref={canvasRef} 
      width={400} 
      height={80} 
      className="w-full h-full"
    />
  );
};