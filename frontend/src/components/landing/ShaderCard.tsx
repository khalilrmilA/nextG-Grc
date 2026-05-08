import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const vertexShader = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  #define TWO_PI 6.2831853072
  precision highp float;
  uniform vec2 resolution;
  uniform float time;
  uniform float opacity;

  void main(void) {
    vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
    float t = time * 0.05;
    float lineWidth = 0.002;

    vec3 color = vec3(0.0);
    for(int j = 0; j < 3; j++){
      for(int i = 0; i < 5; i++){
        color[j] += lineWidth * float(i * i) / abs(
          fract(t - 0.01 * float(j) + float(i) * 0.01) * 5.0
          - length(uv)
          + mod(uv.x + uv.y, 0.2)
        );
      }
    }

    gl_FragColor = vec4(color[0], color[1], color[2], opacity);
  }
`;

export function ShaderCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    uniforms: Record<string, { value: any }>;
    rafId: number;
  } | null>(null);
  const [hovered, setHovered] = useState(false);
  const opacityRef = useRef(0);
  const targetOpacityRef = useRef(0);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const camera = new THREE.Camera();
    camera.position.z = 1;
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);

    const uniforms = {
      time: { value: 0.0 },
      resolution: { value: new THREE.Vector2() },
      opacity: { value: 0.0 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
    });

    scene.add(new THREE.Mesh(geometry, material));

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      uniforms.resolution.value.set(renderer.domElement.width, renderer.domElement.height);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      // Smooth fade in/out
      opacityRef.current += (targetOpacityRef.current - opacityRef.current) * 0.06;
      uniforms.opacity.value = opacityRef.current;
      if (opacityRef.current > 0.002) {
        uniforms.time.value += 0.05;
      }
      renderer.render(scene, camera);
      if (sceneRef.current) sceneRef.current.rafId = rafId;
    };

    sceneRef.current = { renderer, uniforms, rafId };
    animate();

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafId);
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, []);

  const handleEnter = () => {
    targetOpacityRef.current = 0.85;
    setHovered(true);
  };
  const handleLeave = () => {
    targetOpacityRef.current = 0;
    setHovered(false);
  };

  return (
    <div
      ref={containerRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={`relative overflow-hidden rounded-2xl ${className}`}
    >
      {/* Shader canvas — absolute behind content */}
      <div
        ref={canvasRef}
        className="absolute inset-0 rounded-2xl transition-opacity duration-500"
        style={{ zIndex: 0 }}
      />
      {/* Content */}
      <div className="relative" style={{ zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}
