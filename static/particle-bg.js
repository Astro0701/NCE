/**
 * 柔和粒子背景效果（浅色主题）
 * 在浅灰底上绘制柔和的粉彩光斑，保持新拟态界面的干净质感
 */

class ParticleBackground {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            console.error(`Canvas element with id "${canvasId}" not found`);
            return;
        }

        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.particleCount = 12;
        this.mouse = { x: null, y: null, radius: 250 };

        // 柔和粉彩色系（与 Soft UI 调色板一致）
        this.colorData = [
            // 柔和蓝色系
            { hex: '#B4D3F0', rgb: [180, 211, 240] },
            { hex: '#C8E0F4', rgb: [200, 224, 244] },
            { hex: '#A9C7E8', rgb: [169, 199, 232] },
            // 柔和薄荷系
            { hex: '#BFE8D9', rgb: [191, 232, 217] },
            { hex: '#D4F5E9', rgb: [212, 245, 233] },
            // 柔和粉色系
            { hex: '#F2CBDD', rgb: [242, 203, 221] },
            { hex: '#F5E0E8', rgb: [245, 224, 232] },
            // 柔和紫色系
            { hex: '#D9CDF2', rgb: [217, 205, 242] },
            { hex: '#E4DCF5', rgb: [228, 220, 245] },
            // 柔和蜜桃系
            { hex: '#F5DFC8', rgb: [245, 223, 200] }
        ];

        // 性能监控
        this.frameCount = 0;
        this.lastFrameTime = performance.now();
        this.fps = 60;
        this.fpsHistory = [];
        this.performanceCheckInterval = 60;

        // 禁区设置（header和footer）
        this.excludedZones = [];
        // 缓存DOM元素引用
        this.headerElement = null;
        this.footerElement = null;
        this.updateExcludedZones();

        this.init();
        this.animate();
        this.addEventListeners();
    }

    updateExcludedZones() {
        this.excludedZones = [];

        // 缓存DOM查询（只在第一次或元素为null时查询）
        if (!this.headerElement) {
            this.headerElement = document.querySelector('.header');
        }
        if (!this.footerElement) {
            this.footerElement = document.querySelector('footer');
        }

        // 获取header区域
        if (this.headerElement) {
            const rect = this.headerElement.getBoundingClientRect();
            this.excludedZones.push({
                top: 0,
                bottom: rect.bottom,
                left: 0,
                right: this.canvas.width,
                name: 'header'
            });
        }

        // 获取footer区域
        if (this.footerElement) {
            const rect = this.footerElement.getBoundingClientRect();
            this.excludedZones.push({
                top: rect.top,
                bottom: this.canvas.height,
                left: 0,
                right: this.canvas.width,
                name: 'footer'
            });
        }
    }

    isInExcludedZone(x, y) {
        for (const zone of this.excludedZones) {
            if (x >= zone.left && x <= zone.right &&
                y >= zone.top && y <= zone.bottom) {
                return zone;
            }
        }
        return null;
    }

    getValidPosition() {
        let x, y;
        let attempts = 0;
        const maxAttempts = 100;

        do {
            x = Math.random() * this.canvas.width;
            y = Math.random() * this.canvas.height;
            attempts++;
        } while (this.isInExcludedZone(x, y) && attempts < maxAttempts);

        // 如果100次都没找到合适位置，放在中间区域
        if (attempts >= maxAttempts) {
            const headerBottom = this.excludedZones.find(z => z.name === 'header')?.bottom || 100;
            const footerTop = this.excludedZones.find(z => z.name === 'footer')?.top || this.canvas.height - 100;
            y = headerBottom + Math.random() * (footerTop - headerBottom);
        }

        return { x, y };
    }

    init() {
        this.resizeCanvas();
        this.updateExcludedZones();
        this.createParticles();
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.updateExcludedZones();
    }

    createParticles() {
        this.particles = [];
        for (let i = 0; i < this.particleCount; i++) {
            const pos = this.getValidPosition();
            const colorData = this.colorData[Math.floor(Math.random() * this.colorData.length)];
            this.particles.push({
                x: pos.x,
                y: pos.y,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                radius: Math.random() * 10 + 10,
                colorData: colorData,
                hex: colorData.hex,
                rgb: colorData.rgb,
                pulseSpeed: Math.random() * 0.008 + 0.004,
                pulsePhase: Math.random() * Math.PI * 2
            });
        }
    }

    drawParticle(particle) {
        // 脉动效果
        particle.pulsePhase += particle.pulseSpeed;
        const pulse = Math.sin(particle.pulsePhase) * 0.3 + 1;
        const currentRadius = particle.radius * pulse;
        const opacity = Math.sin(particle.pulsePhase) * 0.15 + 0.5;

        const [r, g, b] = particle.rgb;
        const glowRadius = currentRadius * 8;

        this.ctx.save();

        // 轻微模糊让光斑过渡更柔和
        if (!document.body.classList.contains('low-performance')) {
            this.ctx.filter = 'blur(4px)';
        }

        const gradient = this.ctx.createRadialGradient(
            particle.x, particle.y, 0,
            particle.x, particle.y, glowRadius
        );
        gradient.addColorStop(0, `rgba(${r},${g},${b},${opacity})`);
        gradient.addColorStop(0.45, `rgba(${r},${g},${b},${opacity * 0.5})`);
        gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);

        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(particle.x, particle.y, glowRadius, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.restore();
    }

    drawConnections() {
        for (let i = 0; i < this.particles.length; i++) {
            for (let j = i + 1; j < this.particles.length; j++) {
                const dx = this.particles[i].x - this.particles[j].x;
                const dy = this.particles[i].y - this.particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < 280) {
                    const opacity = (1 - distance / 280) * 0.16;
                    this.ctx.strokeStyle = `rgba(148, 163, 184, ${opacity})`;
                    this.ctx.lineWidth = 1;

                    this.ctx.beginPath();
                    this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
                    this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
                    this.ctx.stroke();
                }
            }
        }
    }

    updateParticle(particle) {
        // 边界检测和反弹
        if (particle.x < 0 || particle.x > this.canvas.width) {
            particle.vx *= -1;
        }
        if (particle.y < 0 || particle.y > this.canvas.height) {
            particle.vy *= -1;
        }

        // 检测禁区并反弹
        const zone = this.isInExcludedZone(particle.x, particle.y);
        if (zone) {
            const centerY = (zone.top + zone.bottom) * 0.5;

            if (particle.y < centerY) {
                particle.vy = -Math.abs(particle.vy);
                particle.y = zone.top - 10;
            } else {
                particle.vy = Math.abs(particle.vy);
                particle.y = zone.bottom + 10;
            }
        }

        // 鼠标交互 - 吸引效果
        if (this.mouse.x !== null) {
            const dx = this.mouse.x - particle.x;
            const dy = this.mouse.y - particle.y;
            const distSq = dx * dx + dy * dy;
            const radiusSq = this.mouse.radius * this.mouse.radius;

            if (distSq < radiusSq) {
                const distance = Math.sqrt(distSq);
                const force = (this.mouse.radius - distance) / this.mouse.radius;
                const angle = Math.atan2(dy, dx);
                const forceAmount = force * 0.05;
                particle.vx += Math.cos(angle) * forceAmount;
                particle.vy += Math.sin(angle) * forceAmount;
            }
        }

        // 速度衰减
        particle.vx *= 0.99;
        particle.vy *= 0.99;

        // 确保最小速度
        const absVx = Math.abs(particle.vx);
        const absVy = Math.abs(particle.vy);
        if (absVx < 0.05) particle.vx += (Math.random() - 0.5) * 0.05;
        if (absVy < 0.05) particle.vy += (Math.random() - 0.5) * 0.05;

        // 限制最大速度
        const maxSpeed = 1;
        particle.vx = Math.max(-maxSpeed, Math.min(maxSpeed, particle.vx));
        particle.vy = Math.max(-maxSpeed, Math.min(maxSpeed, particle.vy));

        // 更新位置
        particle.x += particle.vx;
        particle.y += particle.vy;

        // 确保粒子在画布内
        particle.x = Math.max(0, Math.min(this.canvas.width, particle.x));
        particle.y = Math.max(0, Math.min(this.canvas.height, particle.y));
    }

    checkPerformance() {
        const currentTime = performance.now();
        const delta = currentTime - this.lastFrameTime;
        this.lastFrameTime = currentTime;

        // 计算当前FPS
        this.fpsHistory.push(1000 / delta);

        // 每60帧检查一次性能
        if (++this.frameCount >= this.performanceCheckInterval) {
            // 计算平均FPS
            let sum = 0;
            const len = this.fpsHistory.length;
            for (let i = 0; i < len; i++) {
                sum += this.fpsHistory[i];
            }
            const avgFps = sum / len;
            this.fps = avgFps;

            // 如果平均FPS低于30，启用低性能模式
            if (avgFps < 30 && !document.body.classList.contains('low-performance')) {
                console.warn(`检测到低性能（FPS: ${avgFps.toFixed(1)}），已简化背景效果`);
                document.body.classList.add('low-performance');
            }

            // 重置
            this.frameCount = 0;
            this.fpsHistory.length = 0;
        }
    }

    animate() {
        // 性能检测
        this.checkPerformance();

        // 完全清空画布（浅色底）
        this.ctx.fillStyle = '#e8e8e8';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 绘制连接线
        this.drawConnections();

        // 更新和绘制粒子
        this.particles.forEach(particle => {
            this.updateParticle(particle);
            this.drawParticle(particle);
        });

        requestAnimationFrame(() => this.animate());
    }

    addEventListeners() {
        // 优化resize事件，使用防抖
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.resizeCanvas();
                this.createParticles();
            }, 150);
        });

        // 优化scroll事件，使用防抖
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                this.updateExcludedZones();
            }, 150);
        }, { passive: true });

        // 鼠标事件
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
        }, { passive: true });

        window.addEventListener('mouseleave', () => {
            this.mouse.x = null;
            this.mouse.y = null;
        });

        // 触摸设备支持
        window.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) {
                this.mouse.x = e.touches[0].clientX;
                this.mouse.y = e.touches[0].clientY;
            }
        }, { passive: true });

        window.addEventListener('touchend', () => {
            this.mouse.x = null;
            this.mouse.y = null;
        });
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    new ParticleBackground('particle-canvas');
});
