'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export default function BarcodeScanner({ onScan, onError }) {
  const scannerRef = useRef(null);
  const [isScanning, setIsScanning] = useState(false);
  const [hasPermission, setHasPermission] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const lastScannedCode = useRef('');
  const lastScanTime = useRef(0);
  const quaggaInstance = useRef(null);

  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.frequency.value = 1200;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.15;
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
      // Audio no soportado o bloqueado
    }
  };

  const handleDetected = useCallback((result) => {
    if (!result || !result.codeResult || !result.codeResult.code) return;
    const code = result.codeResult.code.trim();

    // Evitar lecturas duplicadas en rafaga
    const now = Date.now();
    if (code === lastScannedCode.current && now - lastScanTime.current < 2000) {
      return;
    }
    if (now - lastScanTime.current < 800) {
      return;
    }

    lastScannedCode.current = code;
    lastScanTime.current = now;
    playBeep();

    if (onScan) {
      onScan(code);
    }
  }, [onScan]);

  const startScanner = async () => {
    setErrorMessage('');
    try {
      const Quagga = (await import('@ericblade/quagga2')).default;
      quaggaInstance.current = Quagga;

      if (!scannerRef.current) return;

      Quagga.init(
        {
          inputStream: {
            name: 'Live',
            type: 'LiveStream',
            target: scannerRef.current,
            constraints: {
              facingMode: 'environment', // Camara trasera en telefonos
              width: { min: 640, ideal: 1280, max: 1920 },
              height: { min: 480, ideal: 720, max: 1080 },
            },
          },
          locator: {
            patchSize: 'medium',
            halfSample: true,
          },
          numOfWorkers: typeof navigator !== 'undefined' && navigator.hardwareConcurrency 
            ? Math.min(navigator.hardwareConcurrency, 4) 
            : 2,
          frequency: 10,
          decoder: {
            readers: [
              'ean_reader',
              'ean_8_reader',
              'code_128_reader',
              'code_39_reader',
              'upc_reader',
              'upc_e_reader',
              'codabar_reader',
              'i2of5_reader',
            ],
          },
          locate: true,
        },
        (err) => {
          if (err) {
            console.error('Error inicializando Quagga2:', err);
            setHasPermission(false);
            const msg = err.name === 'NotAllowedError'
              ? 'Permiso de cámara denegado. Habilita los permisos en tu navegador.'
              : err.message || 'No se pudo acceder a la cámara trasera.';
            setErrorMessage(msg);
            if (onError) onError(msg);
            return;
          }

          Quagga.start();
          Quagga.onDetected(handleDetected);
          setIsScanning(true);
          setHasPermission(true);
        }
      );
    } catch (err) {
      console.error('Error cargando Quagga2:', err);
      setHasPermission(false);
      setErrorMessage(err.message || 'Error al iniciar escáner');
    }
  };

  const stopScanner = () => {
    if (quaggaInstance.current) {
      try {
        quaggaInstance.current.offDetected(handleDetected);
        quaggaInstance.current.stop();
      } catch (e) {
        // ignore
      }
    }
    setIsScanning(false);
  };

  // Escaneo alternativo mediante foto de la camara nativa
  const handlePhotoCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const Quagga = (await import('@ericblade/quagga2')).default;
      const objectUrl = URL.createObjectURL(file);

      Quagga.decodeSingle(
        {
          src: objectUrl,
          numOfWorkers: 2,
          decoder: {
            readers: [
              'ean_reader',
              'ean_8_reader',
              'code_128_reader',
              'code_39_reader',
              'upc_reader',
              'upc_e_reader',
              'codabar_reader',
              'i2of5_reader',
            ],
          },
        },
        (result) => {
          URL.revokeObjectURL(objectUrl);
          if (result && result.codeResult && result.codeResult.code) {
            playBeep();
            if (onScan) onScan(result.codeResult.code.trim());
          } else {
            alert('No se detectó un código de barras claro en la foto. Intenta con mejor iluminación o enfocando más de cerca.');
          }
        }
      );
    } catch (err) {
      console.error('Error decodificando foto:', err);
    }
  };

  useEffect(() => {
    return () => {
      if (quaggaInstance.current) {
        try {
          quaggaInstance.current.offDetected(handleDetected);
          quaggaInstance.current.stop();
        } catch (e) {
          // ignore
        }
      }
    };
  }, [handleDetected]);

  return (
    <div>
      <div className="scanner-container">
        <div
          ref={scannerRef}
          className="quagga-viewport"
          style={{
            width: '100%',
            minHeight: isScanning ? '260px' : '0px',
            display: isScanning ? 'block' : 'none',
            position: 'relative',
          }}
        >
          {/* Laser scanning beam */}
          {isScanning && <div className="scanner-laser-line" />}
        </div>

        {!isScanning && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '220px',
            padding: '24px',
            textAlign: 'center',
          }}>
            {hasPermission === false ? (
              <>
                <i className="bi bi-camera-video-off text-danger" style={{ fontSize: '2.5rem', marginBottom: '12px' }}></i>
                <p style={{ color: 'var(--danger)', marginBottom: '8px', fontWeight: 600 }}>
                  Acceso a la cámara no disponible
                </p>
                <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', maxWidth: '320px' }}>
                  {errorMessage || 'Asegúrate de conceder permisos de cámara en tu navegador.'}
                </p>
              </>
            ) : (
              <>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '16px',
                  background: 'rgba(56, 189, 248, 0.1)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '16px',
                  boxShadow: '0 0 20px rgba(56, 189, 248, 0.15)',
                }}>
                  <i className="bi bi-upc-scan" style={{ fontSize: '2rem', color: 'var(--accent-primary)' }}></i>
                </div>
                <h4 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: '6px' }}>
                  Escáner Quagga2
                </h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', maxWidth: '300px' }}>
                  Optimizado para códigos de barra (EAN, UPC, Code 128) con cámara trasera
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {!isScanning ? (
          <>
            <button
              className="btn btn-primary btn-lg"
              onClick={startScanner}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <i className="bi bi-camera-fill"></i> Activar Cámara
            </button>
            <label
              className="btn btn-secondary btn-lg"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}
            >
              <i className="bi bi-camera"></i> Tomar Foto
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoCapture}
                style={{ display: 'none' }}
              />
            </label>
          </>
        ) : (
          <button
            className="btn btn-danger btn-lg"
            onClick={stopScanner}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            <i className="bi bi-stop-circle-fill"></i> Detener Cámara
          </button>
        )}
      </div>
    </div>
  );
}
