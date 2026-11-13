"use client";

import { useEffect, useRef, useState } from "react";

/** Tam ekran kamera ile barkod/karekod okur; ilk okunan kodu onCode ile döner. */
export function BarcodeScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-camera");
        const [{ BarcodeDetector, prepareZXingModule }, media] = await Promise.all([
          import("barcode-detector/ponyfill"),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }),
        ]);
        stream = media;
        if (cancelled) return media.getTracks().forEach((t) => t.stop());

        // Okuyucu çekirdeği (wasm) CDN yerine uygulamanın kendi sunucusundan yüklenir
        prepareZXingModule({
          overrides: {
            locateFile: (path: string, prefix: string) =>
              path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path,
          },
        });
        const detector = new BarcodeDetector({
          formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf", "qr_code", "data_matrix"],
        });

        const video = videoRef.current!;
        video.srcObject = media;
        await video.play();

        const tick = async () => {
          if (cancelled) return;
          try {
            const found = video.readyState >= 2 ? await detector.detect(video) : [];
            const code = found.find((f) => f.rawValue)?.rawValue;
            if (code && !cancelled) {
              cancelled = true;
              media.getTracks().forEach((t) => t.stop());
              return onCodeRef.current(code);
            }
          } catch {
            // Tek karelik okuma hatası: sonraki karede yeniden dene
          }
          timer = setTimeout(tick, 200);
        };
        tick();
      } catch (e) {
        if (cancelled) return;
        const name = e instanceof Error ? e.name : "";
        setError(
          name === "NotAllowedError"
            ? "Kamera izni verilmedi. Tarayıcı ayarlarından kamera iznini açın ya da malzemeyi elle arayın."
            : "Kamera açılamadı. Malzemeyi elle arayabilirsiniz.",
        );
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scanner" role="dialog" aria-label="Barkod okut">
      <video ref={videoRef} playsInline muted />
      {!error && <div className="scanner-frame" />}
      <div className="scanner-bar">
        <p>{error || "Barkodu çerçevenin içine getirin"}</p>
        <button className="btn" style={{ color: "#14181a" }} onClick={onClose}>
          Kapat · elle ara
        </button>
      </div>
    </div>
  );
}
