import { a as require_react, o as __toESM, t as require_jsx_runtime } from "../index.js";
//#region app/page.tsx
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
var import_jsx_runtime = require_jsx_runtime();
var API = "http://127.0.0.1:8765";
var PAGE_SIZE = 300;
var FRAME_EXPORT_KEY = "insta-library-frame-export";
var FRAMEABLE_PHOTO_EXTENSIONS = new Set([
	"jpg",
	"jpeg",
	"insp"
]);
var emptyStatus = {
	connected: false,
	camera_host: "192.168.42.1",
	connected_at: null,
	last_error: null,
	file_count: 0,
	counts: {
		photo: 0,
		video: 0,
		other: 0
	},
	read_only: true,
	list_source: "not_loaded",
	list_truncated: false
};
function endpoint(path) {
	return `${API}${path}`;
}
function formatDate(value) {
	if (!value) return "未知日期";
	return new Intl.DateTimeFormat("zh-CN", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit"
	}).format(new Date(value));
}
function dayKey(file) {
	return file.captured_at?.slice(0, 10) || "unknown";
}
function formatDay(value) {
	if (value === "unknown") return "日期未知";
	return new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "long",
		day: "numeric",
		weekday: "short"
	}).format(/* @__PURE__ */ new Date(`${value}T12:00:00`));
}
function frameablePhoto(file) {
	return file.kind === "photo" && FRAMEABLE_PHOTO_EXTENSIONS.has(file.extension);
}
function exportDate(value) {
	if (!value) return "CAPTURE TIME UNKNOWN";
	const date = new Date(value);
	const parts = new Intl.DateTimeFormat("en-CA", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false
	}).formatToParts(date);
	const part = (type) => parts.find((item) => item.type === type)?.value || "--";
	return `${part("year")} · ${part("month")} · ${part("day")}   ${part("hour")}:${part("minute")}`;
}
function parseExifExposure(buffer) {
	const empty = {
		aperture: null,
		shutterSeconds: null,
		iso: null
	};
	const view = new DataView(buffer);
	if (view.byteLength < 12 || view.getUint16(0, false) !== 65496) return empty;
	let tiffStart = -1;
	let markerOffset = 2;
	while (markerOffset + 4 <= view.byteLength) {
		if (view.getUint8(markerOffset) !== 255) {
			markerOffset += 1;
			continue;
		}
		const marker = view.getUint8(markerOffset + 1);
		if (marker === 218 || marker === 217) break;
		if (marker === 1 || marker >= 208 && marker <= 215) {
			markerOffset += 2;
			continue;
		}
		const segmentLength = view.getUint16(markerOffset + 2, false);
		if (segmentLength < 2 || markerOffset + 2 + segmentLength > view.byteLength) break;
		if (marker === 225 && segmentLength >= 8 && view.getUint8(markerOffset + 4) === 69 && view.getUint8(markerOffset + 5) === 120 && view.getUint8(markerOffset + 6) === 105 && view.getUint8(markerOffset + 7) === 102 && view.getUint16(markerOffset + 8, false) === 0) {
			tiffStart = markerOffset + 10;
			break;
		}
		markerOffset += segmentLength + 2;
	}
	if (tiffStart < 0 || tiffStart + 8 > view.byteLength) return empty;
	const byteOrder = view.getUint16(tiffStart, false);
	if (byteOrder !== 18761 && byteOrder !== 19789) return empty;
	const littleEndian = byteOrder === 18761;
	const inBounds = (offset, length) => offset >= 0 && offset + length <= view.byteLength;
	const read16 = (offset) => view.getUint16(offset, littleEndian);
	const read32 = (offset) => view.getUint32(offset, littleEndian);
	function readEntryValue(entry, type, count) {
		const unitSize = {
			1: 1,
			3: 2,
			4: 4,
			5: 8,
			9: 4,
			10: 8
		}[type];
		if (!unitSize || count < 1) return null;
		const valueOffset = unitSize * count <= 4 ? entry + 8 : tiffStart + read32(entry + 8);
		if (!inBounds(valueOffset, unitSize)) return null;
		if (type === 1) return view.getUint8(valueOffset);
		if (type === 3) return read16(valueOffset);
		if (type === 4) return read32(valueOffset);
		if (type === 9) return view.getInt32(valueOffset, littleEndian);
		if (type === 5 || type === 10) {
			if (!inBounds(valueOffset, 8)) return null;
			const numerator = type === 5 ? read32(valueOffset) : view.getInt32(valueOffset, littleEndian);
			const denominator = type === 5 ? read32(valueOffset + 4) : view.getInt32(valueOffset + 4, littleEndian);
			return denominator ? numerator / denominator : null;
		}
		return null;
	}
	function readIfd(relativeOffset) {
		const values = /* @__PURE__ */ new Map();
		const start = tiffStart + relativeOffset;
		if (!inBounds(start, 2)) return values;
		const count = read16(start);
		for (let index = 0; index < count; index += 1) {
			const entry = start + 2 + index * 12;
			if (!inBounds(entry, 12)) break;
			const value = readEntryValue(entry, read16(entry + 2), read32(entry + 4));
			if (value !== null && Number.isFinite(value)) values.set(read16(entry), value);
		}
		return values;
	}
	try {
		const exifOffset = readIfd(read32(tiffStart + 4)).get(34665);
		if (exifOffset === void 0) return empty;
		const exif = readIfd(exifOffset);
		const directAperture = exif.get(33437);
		const apexAperture = exif.get(37378);
		const directShutter = exif.get(33434);
		const apexShutter = exif.get(37377);
		return {
			aperture: directAperture ?? (apexAperture !== void 0 ? 2 ** (apexAperture / 2) : null),
			shutterSeconds: directShutter ?? (apexShutter !== void 0 ? 2 ** -apexShutter : null),
			iso: exif.get(34867) ?? exif.get(34855) ?? null
		};
	} catch {
		return empty;
	}
}
async function readExposureMetadata(blob) {
	try {
		return parseExifExposure(await blob.slice(0, Math.min(blob.size, 1024 * 1024)).arrayBuffer());
	} catch {
		return {
			aperture: null,
			shutterSeconds: null,
			iso: null
		};
	}
}
function exposureLine(metadata) {
	const aperture = metadata.aperture && metadata.aperture > 0 ? `F/${metadata.aperture.toFixed(1)}` : "F/—";
	let shutter = "—";
	if (metadata.shutterSeconds && metadata.shutterSeconds > 0) shutter = metadata.shutterSeconds < 1 ? `1/${Math.max(1, Math.round(1 / metadata.shutterSeconds))}` : `${Number(metadata.shutterSeconds.toFixed(1))}s`;
	const iso = metadata.iso && metadata.iso > 0 ? `ISO${Math.round(metadata.iso)}` : "ISO—";
	return `${aperture}   ${shutter}   ${iso}`;
}
function loadImage(blob) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(blob);
		const image = new Image();
		image.onload = () => {
			URL.revokeObjectURL(url);
			resolve(image);
		};
		image.onerror = () => {
			URL.revokeObjectURL(url);
			reject(/* @__PURE__ */ new Error("浏览器无法解码这张照片"));
		};
		image.src = url;
	});
}
function canvasBlob(canvas) {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => blob ? resolve(blob) : reject(/* @__PURE__ */ new Error("相框照片编码失败")), "image/png");
	});
}
function saveBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 1e3);
}
function triggerOriginalDownload(file) {
	const link = document.createElement("a");
	link.href = endpoint(file.download_url);
	link.download = file.name;
	document.body.appendChild(link);
	link.click();
	link.remove();
}
function framedFilename(filename) {
	return `${filename.replace(/\.[^.]+$/, "")}-framed.png`;
}
async function createFramedPhotoFromBlob(blob, details) {
	const [image, exposure] = await Promise.all([loadImage(blob), readExposureMetadata(blob)]);
	await Promise.all([
		document.fonts.load("800 48px \"Frame Display\""),
		document.fonts.load("500 48px \"Frame Mono\""),
		document.fonts.load("48px \"Frame Script\"")
	]);
	const sourceWidth = image.naturalWidth;
	const sourceHeight = image.naturalHeight;
	if (!sourceWidth || !sourceHeight) throw new Error("照片尺寸无效");
	const photoWidth = sourceWidth;
	const photoHeight = sourceHeight;
	const measure = Math.max(900, Math.min(photoWidth, photoHeight));
	const side = Math.round(Math.max(48, Math.min(220, measure * .045)));
	const header = Math.round(Math.max(230, Math.min(820, measure * .2)));
	const footer = Math.round(Math.max(380, Math.min(1200, measure * .3)));
	const canvas = document.createElement("canvas");
	canvas.width = photoWidth + side * 2;
	canvas.height = photoHeight + header + footer;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("浏览器不支持照片合成");
	const background = context.createLinearGradient(0, 0, canvas.width, 0);
	background.addColorStop(0, "#061820");
	background.addColorStop(.48, "#0d4f5a");
	background.addColorStop(1, "#2b9aa6");
	context.fillStyle = background;
	context.fillRect(0, 0, canvas.width, canvas.height);
	const verticalLight = context.createLinearGradient(0, 0, 0, canvas.height);
	verticalLight.addColorStop(0, "rgba(0, 3, 7, .32)");
	verticalLight.addColorStop(.42, "rgba(0, 0, 0, 0)");
	verticalLight.addColorStop(1, "rgba(46, 174, 184, .34)");
	context.fillStyle = verticalLight;
	context.fillRect(0, 0, canvas.width, canvas.height);
	const cornerShade = context.createRadialGradient(0, 0, 0, 0, 0, Math.max(canvas.width, canvas.height) * .62);
	cornerShade.addColorStop(0, "rgba(0, 5, 9, .42)");
	cornerShade.addColorStop(1, "rgba(0, 0, 0, 0)");
	context.fillStyle = cornerShade;
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.save();
	context.shadowColor = "rgba(0, 0, 0, .24)";
	context.shadowBlur = Math.max(12, side * .28);
	context.shadowOffsetY = Math.max(4, side * .1);
	context.fillStyle = "rgba(255,255,255,.08)";
	context.fillRect(side - 1, header - 1, photoWidth + 2, photoHeight + 2);
	context.drawImage(image, side, header, photoWidth, photoHeight);
	context.restore();
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.fillStyle = "#ffffff";
	context.font = `750 ${Math.round(header * .17)}px "Frame Display", "PingFang SC", "Microsoft YaHei", sans-serif`;
	context.fillText("Insta360 Luna Ultra", canvas.width / 2, header * .38);
	context.font = `600 ${Math.round(header * .065)}px "Frame Display", sans-serif`;
	const partnerLine = "CO-ENGINEERED WITH";
	const partnerWidth = context.measureText(partnerLine).width;
	const logoSize = Math.round(header * .2);
	const logoGap = Math.round(header * .025);
	const partnerGroupWidth = partnerWidth + logoGap + logoSize;
	const partnerStart = (canvas.width - partnerGroupWidth) / 2;
	context.textAlign = "left";
	context.fillStyle = "rgba(255,255,255,.82)";
	context.fillText(partnerLine, partnerStart, header * .6);
	const badgeCenterX = partnerStart + partnerWidth + logoGap + logoSize / 2;
	const badgeCenterY = header * .6;
	context.beginPath();
	context.arc(badgeCenterX, badgeCenterY, logoSize * .47, 0, Math.PI * 2);
	context.fillStyle = "#e90019";
	context.fill();
	context.fillStyle = "#ffffff";
	context.font = `400 ${Math.round(logoSize * .39)}px "Frame Script", cursive`;
	context.textAlign = "center";
	context.fillText("Molier", badgeCenterX, badgeCenterY + logoSize * .035, logoSize * .82);
	context.textAlign = "center";
	const footerTop = header + photoHeight;
	context.fillStyle = "#ffffff";
	context.font = `400 ${Math.round(footer * .28)}px "Frame Script", cursive`;
	context.fillText("Luna", canvas.width / 2, footerTop + footer * .27);
	context.fillStyle = "rgba(255,255,255,.72)";
	context.font = `600 ${Math.round(footer * .043)}px "Frame Display", sans-serif`;
	context.fillText("M  O  M  E  N  T", canvas.width / 2, footerTop + footer * .43);
	context.fillStyle = "rgba(255,255,255,.9)";
	context.font = `550 ${Math.round(footer * .052)}px "Frame Mono", monospace`;
	context.fillText(exposureLine(exposure), canvas.width / 2, footerTop + footer * .68);
	context.fillStyle = "rgba(255,255,255,.76)";
	context.font = `500 ${Math.round(footer * .049)}px "Frame Mono", monospace`;
	context.fillText(exportDate(details.capturedAt), canvas.width / 2, footerTop + footer * .82);
	return canvasBlob(canvas);
}
async function createFramedPhoto(file) {
	const response = await fetch(endpoint(file.media_url));
	if (!response.ok) throw new Error(`读取照片失败 (${response.status})`);
	return createFramedPhotoFromBlob(await response.blob(), { capturedAt: file.captured_at });
}
async function jsonRequest(path, init) {
	const response = await fetch(endpoint(path), init);
	const data = await response.json();
	if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
	return data;
}
function VideoThumbnail({ file, onReady, onError }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("video", {
		className: "video-thumbnail",
		src: `${endpoint(file.thumbnail_url)}#t=0.12`,
		muted: true,
		playsInline: true,
		preload: "metadata",
		onLoadedMetadata: (event) => {
			try {
				event.currentTarget.currentTime = .12;
			} catch {}
		},
		onLoadedData: onReady,
		onSeeked: onReady,
		onError,
		"aria-hidden": "true"
	});
}
function MediaVisual({ file }) {
	const [state, setState] = (0, import_react.useState)("loading");
	const [active, setActive] = (0, import_react.useState)(false);
	const containerRef = (0, import_react.useRef)(null);
	const browserPhoto = file.extension === "jpg" || file.extension === "jpeg" || file.extension === "insp";
	const loadable = browserPhoto || file.kind === "video";
	(0, import_react.useEffect)(() => {
		if (!loadable) return;
		const node = containerRef.current;
		if (!node || !("IntersectionObserver" in window)) {
			setActive(true);
			return;
		}
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setActive(true);
				observer.disconnect();
			}
		}, { rootMargin: "1400px 0px" });
		observer.observe(node);
		return () => observer.disconnect();
	}, [loadable]);
	if (!loadable) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: `file-poster ${file.kind}`,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "play-mark",
			children: "RAW"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: file.extension.toUpperCase() })]
	});
	if (state === "error") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: `file-poster preview-failed ${file.kind}`,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "play-mark",
			children: file.kind === "video" ? "▶" : "IMG"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [file.extension.toUpperCase(), " 预览不可用"] })]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		ref: containerRef,
		className: `media-asset ${active ? "active" : "idle"} ${state === "ready" ? "ready" : "loading"}`,
		children: [state === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "preview-skeleton",
			"aria-hidden": "true"
		}), active && (browserPhoto ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
			src: endpoint(file.media_url),
			alt: "",
			loading: "eager",
			decoding: "async",
			onLoad: () => setState("ready"),
			onError: () => setState("error")
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VideoThumbnail, {
			file,
			onReady: () => setState("ready"),
			onError: () => setState("error")
		}))]
	});
}
function PanoramaViewer({ src, alt }) {
	const canvasRef = (0, import_react.useRef)(null);
	const [failed, setFailed] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const context = canvas.getContext("webgl", {
			antialias: true,
			alpha: false
		});
		if (!context) {
			setFailed(true);
			return;
		}
		const gl = context;
		const vertexSource = `
      attribute vec2 aPosition;
      varying vec2 vUv;
      void main() {
        vUv = aPosition * 0.5 + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;
		const fragmentSource = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float uAspect;
      uniform float uYaw;
      uniform float uPitch;
      uniform float uFov;
      const float PI = 3.141592653589793;
      void main() {
        vec2 screen = vUv * 2.0 - 1.0;
        float focal = 1.0 / tan(uFov * 0.5);
        vec3 direction = normalize(vec3(screen.x * uAspect, screen.y, focal));

        float cp = cos(uPitch);
        float sp = sin(uPitch);
        direction = vec3(direction.x, direction.y * cp - direction.z * sp, direction.y * sp + direction.z * cp);
        float cy = cos(uYaw);
        float sy = sin(uYaw);
        direction = vec3(direction.x * cy + direction.z * sy, direction.y, -direction.x * sy + direction.z * cy);

        float longitude = atan(direction.x, direction.z);
        float latitude = asin(clamp(direction.y, -1.0, 1.0));
        vec2 textureUv = vec2(longitude / (2.0 * PI) + 0.5, latitude / PI + 0.5);
        gl_FragColor = texture2D(uTexture, textureUv);
      }
    `;
		function compile(type, source) {
			const shader = gl.createShader(type);
			if (!shader) throw new Error("无法创建全景着色器");
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "全景着色器编译失败");
			return shader;
		}
		let program;
		try {
			program = gl.createProgram();
			gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
			gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("全景渲染器连接失败");
		} catch {
			setFailed(true);
			return;
		}
		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
			-1,
			-1,
			1,
			-1,
			-1,
			1,
			-1,
			1,
			1,
			-1,
			1,
			1
		]), gl.STATIC_DRAW);
		const position = gl.getAttribLocation(program, "aPosition");
		const aspect = gl.getUniformLocation(program, "uAspect");
		const yawUniform = gl.getUniformLocation(program, "uYaw");
		const pitchUniform = gl.getUniformLocation(program, "uPitch");
		const fovUniform = gl.getUniformLocation(program, "uFov");
		const texture = gl.createTexture();
		let yaw = 0;
		let pitch = 0;
		let fov = Math.PI / 2.3;
		let dragging = false;
		let lastX = 0;
		let lastY = 0;
		let imageReady = false;
		const resize = () => {
			const scale = Math.min(window.devicePixelRatio || 1, 2);
			const width = Math.max(1, Math.floor(canvas.clientWidth * scale));
			const height = Math.max(1, Math.floor(canvas.clientHeight * scale));
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
			}
		};
		const render = () => {
			if (!imageReady) return;
			resize();
			gl.viewport(0, 0, canvas.width, canvas.height);
			gl.useProgram(program);
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.enableVertexAttribArray(position);
			gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
			gl.uniform1f(aspect, canvas.width / canvas.height);
			gl.uniform1f(yawUniform, yaw);
			gl.uniform1f(pitchUniform, pitch);
			gl.uniform1f(fovUniform, fov);
			gl.drawArrays(gl.TRIANGLES, 0, 6);
		};
		const image = new Image();
		image.crossOrigin = "anonymous";
		image.onload = () => {
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			try {
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
				if (gl.getError() !== gl.NO_ERROR) throw new Error("全景纹理尺寸超出显卡限制");
				imageReady = true;
				render();
			} catch {
				setFailed(true);
			}
		};
		image.onerror = () => setFailed(true);
		image.src = src;
		const onPointerDown = (event) => {
			dragging = true;
			lastX = event.clientX;
			lastY = event.clientY;
			canvas.setPointerCapture(event.pointerId);
			canvas.classList.add("dragging");
		};
		const onPointerMove = (event) => {
			if (!dragging) return;
			yaw -= (event.clientX - lastX) * .005;
			pitch = Math.max(-1.45, Math.min(1.45, pitch + (event.clientY - lastY) * .005));
			lastX = event.clientX;
			lastY = event.clientY;
			render();
		};
		const onPointerUp = (event) => {
			dragging = false;
			canvas.classList.remove("dragging");
			if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
		};
		const onWheel = (event) => {
			event.preventDefault();
			fov = Math.max(.55, Math.min(1.7, fov + event.deltaY * .001));
			render();
		};
		const resizeObserver = new ResizeObserver(render);
		resizeObserver.observe(canvas);
		canvas.addEventListener("pointerdown", onPointerDown);
		canvas.addEventListener("pointermove", onPointerMove);
		canvas.addEventListener("pointerup", onPointerUp);
		canvas.addEventListener("pointercancel", onPointerUp);
		canvas.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			resizeObserver.disconnect();
			canvas.removeEventListener("pointerdown", onPointerDown);
			canvas.removeEventListener("pointermove", onPointerMove);
			canvas.removeEventListener("pointerup", onPointerUp);
			canvas.removeEventListener("pointercancel", onPointerUp);
			canvas.removeEventListener("wheel", onWheel);
			gl.deleteTexture(texture);
			gl.deleteBuffer(buffer);
			gl.deleteProgram(program);
		};
	}, [src]);
	if (failed) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
		src,
		alt
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "panorama-viewer",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", {
			ref: canvasRef,
			"aria-label": `${alt} 的 360 度全景预览`
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "panorama-hint",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "360°" }), "拖动改变视角 · 滚轮缩放"]
		})]
	});
}
function PhotoModalPreview({ file }) {
	const src = endpoint(file.media_url);
	const [mode, setMode] = (0, import_react.useState)("loading");
	(0, import_react.useEffect)(() => {
		const probe = new Image();
		probe.onload = () => {
			const ratio = probe.naturalWidth / Math.max(1, probe.naturalHeight);
			setMode(ratio >= 1.8 && ratio <= 2.2 ? "panorama" : "flat");
		};
		probe.onerror = () => setMode("error");
		probe.src = src;
		return () => {
			probe.onload = null;
			probe.onerror = null;
		};
	}, [src]);
	if (mode === "loading") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: "modal-loader",
		children: "正在判断照片类型…"
	});
	if (mode === "error") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "raw-message",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "照片无法预览" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "可以下载原文件后使用桌面软件打开。" })]
	});
	if (mode === "panorama") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PanoramaViewer, {
		src,
		alt: file.name
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
		src,
		alt: file.name
	});
}
function Home() {
	const localPhotoInputRef = (0, import_react.useRef)(null);
	const [status, setStatus] = (0, import_react.useState)(emptyStatus);
	const [files, setFiles] = (0, import_react.useState)([]);
	const [filter, setFilter] = (0, import_react.useState)("all");
	const [query, setQuery] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)(null);
	const [selected, setSelected] = (0, import_react.useState)(null);
	const [page, setPage] = (0, import_react.useState)(0);
	const [selectionMode, setSelectionMode] = (0, import_react.useState)(false);
	const [selectedPaths, setSelectedPaths] = (0, import_react.useState)(/* @__PURE__ */ new Set());
	const [appClosing, setAppClosing] = (0, import_react.useState)(false);
	const [frameExport, setFrameExport] = (0, import_react.useState)(false);
	const [exportProgress, setExportProgress] = (0, import_react.useState)(null);
	async function loadFiles() {
		setFiles((await jsonRequest("/api/files")).files);
	}
	async function loadStatus() {
		try {
			const data = await jsonRequest("/api/status");
			setStatus(data);
			if (data.connected) await loadFiles();
			setError(null);
		} catch {
			setError("本地相机服务未启动，请通过启动脚本打开应用。 ");
		}
	}
	(0, import_react.useEffect)(() => {
		loadStatus();
		setFrameExport(window.localStorage.getItem(FRAME_EXPORT_KEY) === "1");
	}, []);
	function updateFrameExport(enabled) {
		setFrameExport(enabled);
		window.localStorage.setItem(FRAME_EXPORT_KEY, enabled ? "1" : "0");
	}
	(0, import_react.useEffect)(() => {
		if (!selected) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const closeOnEscape = (event) => {
			if (event.key === "Escape") setSelected(null);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [selected]);
	async function connect() {
		setBusy(true);
		setError(null);
		try {
			setStatus(await jsonRequest("/api/connect", { method: "POST" }));
			await loadFiles();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "连接相机失败");
			await loadStatus();
		} finally {
			setBusy(false);
		}
	}
	async function refresh() {
		setBusy(true);
		setError(null);
		try {
			const data = await jsonRequest("/api/refresh", { method: "POST" });
			setStatus(data.status);
			setFiles(data.files);
			setPage(0);
			setSelectedPaths(/* @__PURE__ */ new Set());
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "刷新失败");
		} finally {
			setBusy(false);
		}
	}
	async function shutdownApp() {
		setBusy(true);
		setError(null);
		try {
			await jsonRequest("/api/shutdown", { method: "POST" });
			setStatus(emptyStatus);
			setFiles([]);
			setSelected(null);
			setSelectedPaths(/* @__PURE__ */ new Set());
			setSelectionMode(false);
			setAppClosing(true);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "退出应用失败");
		} finally {
			setBusy(false);
		}
	}
	const filtered = (0, import_react.useMemo)(() => {
		const needle = query.trim().toLowerCase();
		return files.filter((file) => {
			if (filter !== "all" && file.kind !== filter) return false;
			return !needle || file.name.toLowerCase().includes(needle);
		});
	}, [
		files,
		filter,
		query
	]);
	const displayedFiles = (0, import_react.useMemo)(() => [...filtered].sort((left, right) => (right.captured_at || "").localeCompare(left.captured_at || "")), [filtered]);
	const totalPages = Math.max(1, Math.ceil(displayedFiles.length / PAGE_SIZE));
	const safePage = Math.min(page, totalPages - 1);
	const pageFiles = displayedFiles.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
	const pageGroups = (0, import_react.useMemo)(() => {
		const groups = /* @__PURE__ */ new Map();
		pageFiles.forEach((file) => {
			const key = dayKey(file);
			const group = groups.get(key) || [];
			group.push(file);
			groups.set(key, group);
		});
		return Array.from(groups, ([key, items]) => ({
			key,
			items
		}));
	}, [pageFiles]);
	function togglePath(path) {
		setSelectedPaths((current) => {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}
	function selectCurrentPage() {
		setSelectedPaths((current) => {
			const next = new Set(current);
			const allSelected = pageFiles.every((file) => next.has(file.path));
			pageFiles.forEach((file) => allSelected ? next.delete(file.path) : next.add(file.path));
			return next;
		});
	}
	function selectWholeDay(key) {
		const dayPaths = files.filter((file) => dayKey(file) === key).map((file) => file.path);
		setSelectedPaths((current) => {
			const next = new Set(current);
			const allSelected = dayPaths.every((path) => next.has(path));
			dayPaths.forEach((path) => allSelected ? next.delete(path) : next.add(path));
			return next;
		});
	}
	function dayIsSelected(key) {
		const dayFiles = files.filter((file) => dayKey(file) === key);
		return dayFiles.length > 0 && dayFiles.every((file) => selectedPaths.has(file.path));
	}
	async function downloadFile(file, withFrame = frameExport) {
		if (!withFrame || !frameablePhoto(file)) {
			triggerOriginalDownload(file);
			return;
		}
		setExportProgress({
			current: 1,
			total: 1,
			framing: true
		});
		setError(null);
		try {
			saveBlob(await createFramedPhoto(file), framedFilename(file.name));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "相框导出失败");
		} finally {
			setExportProgress(null);
		}
	}
	async function exportLocalPhoto(file) {
		const extension = file.name.split(".").pop()?.toLowerCase() || "photo";
		if (!new Set([
			"jpg",
			"jpeg",
			"png",
			"webp"
		]).has(extension)) {
			setError("请选择 JPG、PNG 或 WebP 格式的照片");
			return;
		}
		setExportProgress({
			current: 1,
			total: 1,
			framing: true
		});
		setError(null);
		try {
			saveBlob(await createFramedPhotoFromBlob(file, { capturedAt: Number.isFinite(file.lastModified) && file.lastModified > 0 ? new Date(file.lastModified).toISOString() : null }), framedFilename(file.name));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "本地照片加水印失败");
		} finally {
			setExportProgress(null);
		}
	}
	function mediaCard(file) {
		return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
			className: `media-card ${selectedPaths.has(file.path) ? "selected" : ""}`,
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				className: "media-preview",
				onClick: () => selectionMode ? togglePath(file.path) : setSelected(file),
				"aria-label": selectionMode ? `选择 ${file.name}` : `预览 ${file.name}`,
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MediaVisual, { file }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "type-badge",
						children: file.extension.toUpperCase()
					}),
					file.kind === "video" && !selectionMode && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "preview-action",
						"aria-hidden": "true",
						children: "▶"
					}),
					selectionMode && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: `selection-check ${selectedPaths.has(file.path) ? "checked" : ""}`,
						children: selectedPaths.has(file.path) ? "✓" : ""
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "media-meta",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					title: file.name,
					children: file.name
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: formatDate(file.captured_at) })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: `download-icon ${frameExport && frameablePhoto(file) ? "framed" : ""}`,
					onClick: () => void downloadFile(file),
					title: frameExport && frameablePhoto(file) ? "导出带相框照片" : "下载原文件",
					"aria-label": `下载 ${file.name}`,
					disabled: exportProgress !== null,
					children: frameExport && frameablePhoto(file) ? "▣" : "↓"
				})]
			})]
		}, file.path);
	}
	async function downloadSelected() {
		const chosen = files.filter((file) => selectedPaths.has(file.path));
		setError(null);
		try {
			for (let index = 0; index < chosen.length; index += 1) {
				const file = chosen[index];
				setExportProgress({
					current: index + 1,
					total: chosen.length,
					framing: false
				});
				triggerOriginalDownload(file);
				await new Promise((resolve) => window.setTimeout(resolve, 120));
			}
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "批量导出失败");
		} finally {
			setExportProgress(null);
		}
	}
	if (appClosing) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "shutdown-screen",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "shutdown-card",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "shutdown-mark",
					children: "✓"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "eyebrow",
					children: "SAFE DISCONNECT"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "相机已安全断开" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "本地服务已经退出，现在可以直接关闭这个页面。下次使用时双击 Insta Library 图标即可。" })
			]
		})
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "app-shell",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "topbar",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "brand",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "brand-mark",
						children: "360"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "eyebrow",
						children: "LOCAL CAMERA LIBRARY"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "Insta Library" })] })]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: `status-pill ${status.connected ? "online" : "offline"}`,
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "status-dot" }), status.connected ? "相机已连接" : "等待相机"]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "hero-panel",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "hero-copy",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "eyebrow",
							children: "READ-ONLY · DIRECT WIFI"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: status.connected ? "相机素材已就绪" : "直接浏览相机里的每一帧" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: status.connected ? `已从 ${status.camera_host} 读取 ${status.file_count} 个文件。也可以导入电脑里的照片，直接生成同款 Molier 水印相框。` : "连接相机 Wi‑Fi 可以浏览素材；不连接相机时，也能直接导入电脑里的照片添加 Molier 水印相框。" })
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "hero-actions",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							ref: localPhotoInputRef,
							className: "local-photo-input",
							type: "file",
							accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
							onChange: (event) => {
								const file = event.currentTarget.files?.[0];
								event.currentTarget.value = "";
								if (file) exportLocalPhoto(file);
							}
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "local-frame-button",
							onClick: () => localPhotoInputRef.current?.click(),
							disabled: exportProgress !== null,
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								"aria-hidden": "true",
								children: "＋"
							}), "导入照片加水印"]
						}),
						status.connected ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "primary-button",
							onClick: refresh,
							disabled: busy,
							children: busy ? "正在读取…" : "刷新素材"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "text-button",
							onClick: shutdownApp,
							disabled: busy,
							children: "断开并退出"
						})] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "primary-button",
							onClick: connect,
							disabled: busy,
							children: busy ? "连接中…" : "连接相机"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "text-button",
							onClick: shutdownApp,
							disabled: busy,
							children: "退出应用"
						})] })
					]
				})]
			}),
			error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "error-banner",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "!" }), error]
			}),
			status.connected && status.list_truncated && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "warning-banner",
				children: "当前固件关闭了 HTTP 目录索引，只读协议只能确认前 500 个文件；界面分页不受影响，但更早文件可能未列出。"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "stats-row",
				"aria-label": "素材统计",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "stat",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: status.file_count }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "全部文件" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "stat",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: status.counts.photo }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "照片" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "stat",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: status.counts.video }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "视频与低码率预览" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "stat read-only",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "只读" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "安全模式始终开启" })]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "library-section",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "library-toolbar",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "filter-tabs",
							role: "tablist",
							"aria-label": "素材类型",
							children: [
								"all",
								"photo",
								"video"
							].map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: filter === value ? "active" : "",
								onClick: () => {
									setFilter(value);
									setPage(0);
								},
								role: "tab",
								"aria-selected": filter === value,
								children: value === "all" ? "全部" : value === "photo" ? "照片" : "视频"
							}, value))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "search-box",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "⌕" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: query,
								onChange: (event) => {
									setQuery(event.target.value);
									setPage(0);
								},
								placeholder: "搜索文件名或日期",
								"aria-label": "搜索素材"
							})]
						}),
						status.connected && !selectionMode && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: `frame-toggle ${frameExport ? "active" : ""}`,
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: frameExport,
									onChange: (event) => updateFrameExport(event.target.checked)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "frame-toggle-art",
									"aria-hidden": "true",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "相框导出" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: frameExport ? "照片将合成相框" : "当前下载原图" })] })
							]
						}),
						status.connected && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "selection-actions",
							children: [selectionMode && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: "select-page-button",
								onClick: selectCurrentPage,
								children: "选择本页"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: `select-mode-button ${selectionMode ? "active" : ""}`,
								onClick: () => {
									setSelectionMode((value) => !value);
									if (selectionMode) setSelectedPaths(/* @__PURE__ */ new Set());
								},
								children: selectionMode ? "退出选择" : "批量选择"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "result-count",
							children: [filtered.length, " 项"]
						})
					]
				}), !status.connected ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "empty-state",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "camera-shape",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "360" })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "连接相机后，素材会出现在这里" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "电脑无需互联网，只需连接 Insta360 相机热点。" })
					]
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "date-groups",
					children: pageGroups.map(({ key, items }) => {
						const fullDayCount = files.filter((file) => dayKey(file) === key).length;
						return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
							className: "date-group",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "date-group-head",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: formatDay(key) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
									"当天共 ",
									fullDayCount,
									" 项"
								] })] }), selectionMode && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: dayIsSelected(key) ? "active" : "",
									onClick: () => selectWholeDay(key),
									children: dayIsSelected(key) ? "取消当天全部" : "选择当天全部"
								})]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "media-grid",
								children: items.map(mediaCard)
							})]
						}, key);
					})
				}), filtered.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
					className: "pagination",
					"aria-label": "素材分页",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							disabled: safePage === 0,
							onClick: () => {
								setPage(safePage - 1);
								window.scrollTo({
									top: 560,
									behavior: "smooth"
								});
							},
							children: "上一页"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
							"第 ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: safePage + 1 }),
							" / ",
							totalPages,
							" 页 · 每页最多 ",
							PAGE_SIZE,
							" 项"
						] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							disabled: safePage >= totalPages - 1,
							onClick: () => {
								setPage(safePage + 1);
								window.scrollTo({
									top: 560,
									behavior: "smooth"
								});
							},
							children: "下一页"
						})
					]
				})] })]
			}),
			selectionMode && selectedPaths.size > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "batch-bar",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: selectedPaths.size }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "已选择" })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "batch-original-badge",
						children: "批量仅原图"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "batch-secondary",
						onClick: selectCurrentPage,
						children: pageFiles.every((file) => selectedPaths.has(file.path)) ? "取消本页" : "选择本页"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "batch-secondary",
						onClick: () => setSelectedPaths(/* @__PURE__ */ new Set()),
						children: "清空"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "primary-button",
						onClick: () => void downloadSelected(),
						disabled: exportProgress !== null,
						children: exportProgress ? `下载 ${exportProgress.current}/${exportProgress.total}` : "下载所选"
					})
				]
			}),
			exportProgress && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "export-toast",
				role: "status",
				"aria-live": "polite",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "export-spinner",
					"aria-hidden": "true"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: exportProgress.framing ? "正在生成原尺寸无损 PNG" : "正在准备原文件下载" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
					exportProgress.current,
					" / ",
					exportProgress.total
				] })] })]
			}),
			selected && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "modal-backdrop",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": selected.name,
				onMouseDown: () => setSelected(null),
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "modal",
					onMouseDown: (event) => event.stopPropagation(),
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "modal-head",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: selected.extension.toUpperCase() }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: selected.name })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								onClick: () => setSelected(null),
								"aria-label": "关闭预览",
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "modal-media",
							children: selected.extension === "jpg" || selected.extension === "jpeg" || selected.extension === "insp" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PhotoModalPreview, { file: selected }) : selected.kind === "video" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "video-player-wrap",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("video", {
									src: endpoint(selected.thumbnail_url),
									controls: true,
									autoPlay: true,
									playsInline: true,
									preload: "metadata"
								}), selected.proxy_path && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "proxy-note",
									children: "正在使用低码率代理流畅预览 · 下载仍为原文件"
								})]
							}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "raw-message",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "RAW 文件" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "浏览器无法直接显示 DNG，请下载后使用照片软件打开。" })]
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "modal-footer",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: formatDate(selected.captured_at) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: selected.path })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "modal-download-actions",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
									className: "modal-secondary-button",
									href: endpoint(selected.download_url),
									children: "下载原文件"
								}), frameablePhoto(selected) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "primary-button",
									onClick: () => void downloadFile(selected, true),
									disabled: exportProgress !== null,
									children: exportProgress ? "正在生成…" : "导出带相框照片"
								})]
							})]
						})
					]
				})
			})
		]
	});
}
//#endregion
export { Home as default };
