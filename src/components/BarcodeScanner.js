'use client';

import { useEffect, useRef, useState } from 'react';

export default function BarcodeScanner({ onScan, onError }) {
  const scannerRef = useRef(null);
  const html5QrCodeRef = useRef(null);
  const [isScanning, setIsScanning] = useState(false);
  const [hasPermission, setHasPermission] = useState(null);

  const startScanner = async () => {
    try {
      // Importar dinámicamente para evitar SSR issues
      const { Html5Qrcode } = await import('html5-qrcode');

      if (html5QrCodeRef.current) {
        try { await html5QrCodeRef.current.stop(); } catch (e) { /* ignore */ }
      }

      const scanner = new Html5Qrcode('barcode-reader');
      html5QrCodeRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 280, height: 150 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          // Beep sound on scan
          try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.frequency.value = 1200;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.1;
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.1);
          } catch (e) { /* audio not supported */ }

          if (onScan) onScan(decodedText);
        },
        () => { /* ignore scan failures */ }
      );

      setIsScanning(true);
      setHasPermission(true);
    } catch (err) {
      console.error('Error al iniciar escáner:', err);
      setHasPermission(false);
      if (onError) onError(err.message || 'No se pudo acceder a la cámara');
    }
  };

  const stopScanner = async () => {
    if (html5QrCodeRef.current) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      } catch (e) { /* ignore */ }
    }
    setIsScanning(false);
  };

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (html5QrCodeRef.current) {
        try { html5QrCodeRef.current.stop(); } catch (e) { /* ignore */ }
      }
    };
  }, []);

  return (
    <div>
      <div className="scanner-container" style={{ minHeight: isScanning ? '300px' : '200px' }}>
        <div id="barcode-reader" ref={scannerRef} style={{ width: '100%' }} />

        {!isScanning && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '200px',
            padding: '24px',
          }}>
            {hasPermission === false ? (
              <>
                <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🚫</div>
                <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '16px' }}>
                  No se pudo acceder a la cámara. Verifica los permisos del navegador.
                </p>
              </>
            ) : (
              <>
                <i className="bi bi-camera" style={{ fontSize: '2.8rem', marginBottom: '12px', display: 'block', color: 'var(--accent-primary)' }}></i>
                <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '16px' }}>
                  Presiona el botón para activar la cámara y escanear
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '16px', justifyContent: 'center' }}>
        {!isScanning ? (
          <button className="btn btn-primary btn-lg" onClick={startScanner} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <i className="bi bi-camera" style={{ fontSize: '1.2rem' }}></i> Activar Cámara
          </button>
        ) : (
          <button className="btn btn-danger btn-lg" onClick={stopScanner} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <i className="bi bi-stop-circle" style={{ fontSize: '1.2rem' }}></i> Detener Escáner
          </button>
        )}
      </div>
    </div>
  );
}
