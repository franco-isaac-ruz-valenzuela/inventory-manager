'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export default function BarcodeScanner({ onScan, onError }) {
  const [isScanning, setIsScanning] = useState(false);
  const [hasPermission, setHasPermission] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [scannerEngine, setScannerEngine] = useState('zxing'); // 'zxing' (Html5Qrcode) o 'quagga'
  
  const lastScannedCode = useRef('');
  const lastScanTime = useRef(0);
  const html5QrCodeRef = useRef(null);
  const quaggaRef = useRef(null);
  const quaggaContainerRef = useRef(null);

  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.frequency.value = 1350;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.2;
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
      // Audio no soportado o bloqueado
    }
  };

  const handleScanSuccess = useCallback((decodedText) => {
    if (!decodedText) return;
    const code = decodedText.trim();

    const now = Date.now();
    // Evitar lecturas duplicadas en rafaga
    if (code === lastScannedCode.current && now - lastScanTime.current < 2500) {
      return;
    }
    if (now - lastScanTime.current < 900) {
      return;
    }

    lastScannedCode.current = code;
    lastScanTime.current = now;
    playBeep();

    if (onScan) {
      onScan(code);
    }
  }, [onScan]);

  // Detener cualquier escáner activo
  const stopAllScanners = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        await html5QrCodeRef.current.clear();
      } catch (e) {
        // ignore
      }
      html5QrCodeRef.current = null;
    }

    if (quaggaRef.current) {
      try {
        quaggaRef.current.stop();
      } catch (e) {
        // ignore
      }
      quaggaRef.current = null;
    }

    setIsScanning(false);
  };

  // Iniciar con Html5Qrcode (ZXing + BarcodeDetector por hardware)
  const startHtml5Qrcode = async (preferredCameraId) => {
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

      await stopAllScanners();

      // Configurar formatos de códigos 1D retail y QR
      const formatsToSupport = [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.QR_CODE,
      ];

      const html5QrCode = new Html5Qrcode('barcode-reader', {
        formatsToSupport,
        verbose: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true, // Aceleración por hardware en Android
        },
      });

      html5QrCodeRef.current = html5QrCode;

      // Obtener cámaras disponibles
      try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
          setCameras(devices);
        }
      } catch (e) {
        // ignore
      }

      const scanConfig = {
        fps: 15,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const w = Math.min(Math.floor(viewfinderWidth * 0.88), 340);
          const h = Math.min(Math.floor(w * 0.55), 180);
          return { width: Math.max(w, 200), height: Math.max(h, 90) };
        },
        aspectRatio: 1.333333,
      };

      // Si hay cámara seleccionada, usar su ID; si no, preferir cámara trasera
      const cameraConstraint = preferredCameraId
        ? { deviceId: { exact: preferredCameraId } }
        : { facingMode: 'environment' };

      await html5QrCode.start(
        cameraConstraint,
        scanConfig,
        (decodedText) => handleScanSuccess(decodedText),
        () => { /* ignorar frames sin codigo */ }
      );

      setIsScanning(true);
      setHasPermission(true);
    } catch (err) {
      console.error('Error iniciando Html5Qrcode:', err);
      // Si falló por constraint, intentar con true para cualquier cámara
      try {
        if (html5QrCodeRef.current) {
          await html5QrCodeRef.current.start(
            true,
            { fps: 15, qrbox: { width: 280, height: 150 } },
            (decodedText) => handleScanSuccess(decodedText),
            () => {}
          );
          setIsScanning(true);
          setHasPermission(true);
          return;
        }
      } catch (fallbackErr) {
        console.error('Fallback camera error:', fallbackErr);
      }

      setHasPermission(false);
      const msg = err.name === 'NotAllowedError'
        ? 'Permiso de cámara denegado en el navegador.'
        : err.message || 'No se pudo acceder a la cámara.';
      setErrorMessage(msg);
      if (onError) onError(msg);
    }
  };

  // Iniciar con Quagga2 optimizado (sin WebWorkers rotos y con resolución nítida)
  const startQuagga = async () => {
    try {
      const Quagga = (await import('@ericblade/quagga2')).default;
      quaggaRef.current = Quagga;

      await stopAllScanners();

      if (!quaggaContainerRef.current) return;

      Quagga.init(
        {
          inputStream: {
            name: 'Live',
            type: 'LiveStream',
            target: quaggaContainerRef.current,
            constraints: {
              facingMode: 'environment',
              width: { min: 640, ideal: 1280, max: 1920 },
              height: { min: 480, ideal: 720, max: 1080 },
            },
          },
          locator: {
            patchSize: 'large',
            halfSample: false, // CLAVE: No degradar resolucion para codigos de barra delgados
          },
          numOfWorkers: 0, // CLAVE: 0 workers evita fallos de hilos en Webpack/Next.js
          frequency: 10,
          decoder: {
            readers: [
              'ean_reader',
              'ean_8_reader',
              'code_128_reader',
              'code_39_reader',
              'upc_reader',
              'upc_e_reader',
            ],
          },
          locate: true,
        },
        (err) => {
          if (err) {
            console.error('Error inicializando Quagga:', err);
            setHasPermission(false);
            setErrorMessage(err.message || 'Error al iniciar Quagga2');
            return;
          }

          Quagga.start();
          Quagga.onDetected((result) => {
            if (result && result.codeResult && result.codeResult.code) {
              handleScanSuccess(result.codeResult.code);
            }
          });
          setIsScanning(true);
          setHasPermission(true);
        }
      );
    } catch (err) {
      console.error('Error cargando Quagga:', err);
      setHasPermission(false);
      setErrorMessage(err.message || 'Error al iniciar escáner');
    }
  };

  const handleStart = async (engine = scannerEngine, camId = selectedCameraId) => {
    setErrorMessage('');
    if (engine === 'quagga') {
      await startQuagga();
    } else {
      await startHtml5Qrcode(camId);
    }
  };

  const handleStop = async () => {
    await stopAllScanners();
  };

  const handleCameraChange = async (e) => {
    const camId = e.target.value;
    setSelectedCameraId(camId);
    if (isScanning) {
      await handleStart(scannerEngine, camId);
    }
  };

  const handleEngineChange = async (engine) => {
    setScannerEngine(engine);
    if (isScanning) {
      await handleStart(engine, selectedCameraId);
    }
  };

  // Decodificación alternativa mediante toma de foto de alta resolución
  const handlePhotoCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      const tempScanner = new Html5Qrcode('barcode-reader-temp', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
        verbose: false,
      });

      const decodedText = await tempScanner.scanFile(file, true);
      if (decodedText) {
        handleScanSuccess(decodedText);
      }
      await tempScanner.clear();
    } catch (err) {
      console.log('Html5Qrcode file scan failed, trying Quagga fallback...');
      try {
        const Quagga = (await import('@ericblade/quagga2')).default;
        const objectUrl = URL.createObjectURL(file);
        Quagga.decodeSingle(
          {
            src: objectUrl,
            numOfWorkers: 0,
            decoder: {
              readers: ['ean_reader', 'ean_8_reader', 'code_128_reader', 'code_39_reader', 'upc_reader'],
            },
          },
          (result) => {
            URL.revokeObjectURL(objectUrl);
            if (result && result.codeResult && result.codeResult.code) {
              handleScanSuccess(result.codeResult.code);
            } else {
              alert('No se pudo detectar el código de barras en la foto. Intenta con mejor iluminación o enfocando más de cerca.');
            }
          }
        );
      } catch (fallbackErr) {
        console.error('Error procesando foto:', fallbackErr);
        alert('No se detectó un código de barras claro. Intenta nuevamente.');
      }
    }
  };

  useEffect(() => {
    return () => {
      stopAllScanners();
    };
  }, []);

  return (
    <div>
      {/* Selector de Motor de Escaneo */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255, 255, 255, 0.03)',
        padding: '6px 12px',
        borderRadius: 'var(--radius-md)',
        marginBottom: '12px',
        border: '1px solid var(--border-color)',
        fontSize: 'var(--font-size-xs)',
      }}>
        <span style={{ color: 'var(--text-muted)' }}>Motor de lectura:</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className={`btn btn-sm ${scannerEngine === 'zxing' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => handleEngineChange('zxing')}
            style={{ padding: '3px 10px', fontSize: '11px' }}
          >
            ⚡ ZXing (Alta Velocidad)
          </button>
          <button
            type="button"
            className={`btn btn-sm ${scannerEngine === 'quagga' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => handleEngineChange('quagga')}
            style={{ padding: '3px 10px', fontSize: '11px' }}
          >
            🎯 Quagga2
          </button>
        </div>
      </div>

      {/* Contenedor del Visor */}
      <div className="scanner-container">
        {/* Div para Html5Qrcode */}
        <div
          id="barcode-reader"
          style={{
            width: '100%',
            display: isScanning && scannerEngine === 'zxing' ? 'block' : 'none',
          }}
        />

        {/* Div para Quagga2 */}
        <div
          ref={quaggaContainerRef}
          className="quagga-viewport"
          style={{
            width: '100%',
            minHeight: isScanning && scannerEngine === 'quagga' ? '260px' : '0px',
            display: isScanning && scannerEngine === 'quagga' ? 'block' : 'none',
          }}
        />

        {/* Div oculto para escaneo de fotos */}
        <div id="barcode-reader-temp" style={{ display: 'none' }} />

        {/* Láser escáner activo */}
        {isScanning && <div className="scanner-laser-line" />}

        {/* Estado Inactivo */}
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
                  Lector de Códigos de Barra
                </h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', maxWidth: '300px' }}>
                  Apunta la cámara trasera a cualquier código (EAN-13, Code 128, UPC)
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Selector de cámara si hay más de 1 lente */}
      {cameras.length > 1 && (
        <div style={{ marginTop: '10px' }}>
          <select
            className="form-input"
            value={selectedCameraId}
            onChange={handleCameraChange}
            style={{ fontSize: 'var(--font-size-xs)', padding: '6px 10px' }}
          >
            <option value="">Cámara trasera automática</option>
            {cameras.map((cam, idx) => (
              <option key={cam.id} value={cam.id}>
                {cam.label || `Lente ${idx + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Botones de Acción */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {!isScanning ? (
          <>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => handleStart()}
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
            onClick={handleStop}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            <i className="bi bi-stop-circle-fill"></i> Detener Cámara
          </button>
        )}
      </div>
    </div>
  );
}
