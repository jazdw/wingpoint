import { useEffect, useRef } from 'react';

interface WinnerCelebrationProps {
  winners: string[];
  onClose: () => void;
}

/** Full-screen winner popup with a lightweight canvas confetti burst. */
export function WinnerCelebration({ winners, onClose }: WinnerCelebrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const colors = ['#2f6b45', '#d9a441', '#0070cc', '#ef4d96', '#f2c14e', '#4f9d70'];
    const particles = Array.from({ length: 180 }, () => ({
      x: Math.random() * width,
      y: Math.random() * -height,
      size: 6 + Math.random() * 9,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedY: 2 + Math.random() * 4,
      speedX: -1.5 + Math.random() * 3,
      rotation: Math.random() * Math.PI,
      rotationSpeed: -0.12 + Math.random() * 0.24,
    }));

    const onResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    let raf = 0;
    const draw = () => {
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        particle.y += particle.speedY;
        particle.x += particle.speedX;
        particle.rotation += particle.rotationSpeed;
        if (particle.y > height + 20) {
          particle.y = -20;
          particle.x = Math.random() * width;
        }
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.6);
        context.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const headline =
    winners.length === 1 ? `${winners[0]} wins!` : `${winners.join(' & ')} tie!`;

  return (
    <div className="celebration" role="dialog" aria-modal="true" aria-label="Game complete">
      <canvas ref={canvasRef} className="celebration-canvas" />
      <div className="celebration-card card">
        <div className="celebration-trophy" aria-hidden="true">
          🏆
        </div>
        <h2>{headline}</h2>
        <p className="muted">Game complete</p>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Nice!
        </button>
      </div>
    </div>
  );
}
