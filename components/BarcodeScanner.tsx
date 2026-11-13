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
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-camera");
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current!,
          (result) => {
            if (result && !cancelled) {
              cancelled = true;
              controls.stop();
              onCodeRef.current(result.getText());
            }
          },
        );
        if (cancelled) controls.stop();
        else stop = () => controls.stop();
      } catch (e) {
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
      stop?.();
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
