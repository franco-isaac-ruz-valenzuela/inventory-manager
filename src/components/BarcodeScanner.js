'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export default function BarcodeScanner({ onScan, onError }) {
  const [isScanning, setIsScanning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const [hasPermission, setHasPermission] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [scannerEngine, setScannerEngine] = useState('zxing'); // 'zxing' (Html5Qrcode) o 'quagga'
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  
  const lastScannedCode = useRef('');
  const lastScanTime = useRef(0);
  const html5QrCodeRef = useRef(null);
  const quaggaRef = useRef(null);
  const quaggaContainerRef = useRef(null);

  // Detectar iOS al montar
  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      setIsIOSDevice(isIOS);
    }
  }, []);

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
      // Audio bloqueado o no soportado
    }
  };

  const handleScanSuccess = useCallback((decodedText) => {
    if (!decodedText) return;
    const code = decodedText.trim();

    const now = Date.now();
    // Evitar lecturas duplicadas en ráfaga
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

  // Detener cualquier escáner activo de forma limpia
  const stopAllScanners = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        await html5QrCodeRef.current.clear();
      } catch (e) {
        console.warn('Error cerrando Html5Qrcode:', e);
      }
      html5QrCodeRef.current = null;
    }

    if (quaggaRef.current) {
      try {
        quaggaRef.current.stop();
      } catch (e) {
        console.warn('Error cerrando Quagga:', e);
      }
      quaggaRef.current = null;
    }

    setIsScanning(false);
    setIsStarting(false);
  };

  // Iniciar con Html5Qrcode (ZXing)
  const startHtml5Qrcode = async (preferredCameraId) => {
    setIsStarting(true);
    setErrorMessage('');

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

      await stopAllScanners();
      setIsStarting(true);

      // Formatos de códigos de barra retail y 2D
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
          // Desactivar BarcodeDetector nativo en iOS para evitar bugs en WebKit
          useBarCodeDetectorIfSupported: !isIOSDevice,
        },
      });

      html5QrCodeRef.current = html5QrCode;

      // Configuración de escaneo sin aspectRatio (clave para no romper iOS Safari)
      const scanConfig = {
        fps: 15,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const w = Math.min(Math.floor(viewfinderWidth * 0.88), 340);
          const h = Math.min(Math.floor(w * 0.55), 180);
          return { width: Math.max(w, 180), height: Math.max(h, 80) };
        },
        disableFlip: true,
      };

      const cameraConstraint = preferredCameraId
        ? { deviceId: { exact: preferredCameraId } }
        : { facingMode: 'environment' };

      // Intento 1: Cámara trasera con configuración estándar
      try {
        await html5QrCode.start(
          cameraConstraint,
          scanConfig,
          (decodedText) => handleScanSuccess(decodedText),
          () => {}
        );
      } catch (firstErr) {
        console.warn('Fallo intento 1, reintentando con constraint flexible:', firstErr);
        // Intento 2: Sin qrbox y con constraint ideal
        try {
          await html5QrCode.start(
            { facingMode: { ideal: 'environment' } },
            { fps: 15 },
            (decodedText) => handleScanSuccess(decodedText),
            () => {}
          );
        } catch (secondErr) {
          console.warn('Fallo intento 2, reintentando con cámara por defecto:', secondErr);
          // Intento 3: Sin constraints estrictas
          await html5QrCode.start(
            { facingMode: 'user' },
            { fps: 15 },
            (decodedText) => handleScanSuccess(decodedText),
            () => {}
          );
        }
      }

      setIsScanning(true);
      setIsStarting(false);
      setHasPermission(true);

      // En iOS Safari, asegurar atributos playsinline y autoplay en el elemento de video
      setTimeout(() => {
        const video = document.querySelector('#barcode-reader video');
        if (video) {
          video.setAttribute('playsinline', 'true');
          video.setAttribute('webkit-playsinline', 'true');
          video.setAttribute('muted', 'true');
          video.setAttribute('autoplay', 'true');
          video.play().catch(() => {});
        }
      }, 300);

      // Una vez que el stream está activo, cargar de forma segura las cámaras disponibles
      try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
          setCameras(devices);
        }
      } catch (camErr) {
        console.warn('No se pudo listar cámaras adicionales:', camErr);
      }
    } catch (err) {
      console.error('Error iniciando Html5Qrcode:', err);
      setIsStarting(false);
      setIsScanning(false);
      setHasPermission(false);

      let msg = '';
      if (err?.name === 'NotAllowedError' || err?.message?.includes('Permission denied') || err?.message?.includes('NotAllowedError')) {
        msg = isIOSDevice
          ? 'Permiso de cámara bloqueado en Safari. En la barra de Safari toca "aA" > "Configuración del sitio web" > cambia Cámara a "Permitir" y recarga.'
          : 'Permiso de cámara denegado. Concede permisos de cámara en tu navegador.';
      } else if (err?.name === 'NotFoundError' || err?.message?.includes('NotFound')) {
        msg = 'No se encontró ninguna cámara disponible en este dispositivo.';
      } else {
        msg = err?.message || 'No se pudo acceder a la cámara. Intenta con el botón "Tomar Foto".';
      }

      setErrorMessage(msg);
      if (onError) onError(msg);
    }
  };

  // Iniciar con Quagga2
  const startQuagga = async () => {
    setIsStarting(true);
    setErrorMessage('');

    try {
      const Quagga = (await import('@ericblade/quagga2')).default;
      quaggaRef.current = Quagga;

      await stopAllScanners();
      setIsStarting(true);

      if (!quaggaContainerRef.current) {
        setIsStarting(false);
        return;
      }

      Quagga.init(
        {
          inputStream: {
            name: 'Live',
            type: 'LiveStream',
            target: quaggaContainerRef.current,
            constraints: {
              facingMode: 'environment',
            },
          },
          locator: {
            patchSize: 'large',
            halfSample: false, // Máxima nitidez para códigos delgados
          },
          numOfWorkers: 0, // 0 workers evita bloqueos de hilos en iOS Safari y Webpack
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
          setIsStarting(false);
          if (err) {
            console.error('Error inicializando Quagga:', err);
            setHasPermission(false);
            setErrorMessage(err.message || 'Error al iniciar Quagga2');
            return;
          }

          Quagga.start();

          // Asegurar playsinline en iOS
          const quaggaVideo = quaggaContainerRef.current?.querySelector('video');
          if (quaggaVideo) {
            quaggaVideo.setAttribute('playsinline', 'true');
            quaggaVideo.setAttribute('webkit-playsinline', 'true');
            quaggaVideo.setAttribute('muted', 'true');
            quaggaVideo.setAttribute('autoplay', 'true');
            quaggaVideo.play().catch(() => {});
          }

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
      setIsStarting(false);
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

  // Captura de foto directa (100% compatible con iPhone/Android mediante cámara nativa)
  const handlePhotoCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingPhoto(true);
    setErrorMessage('');

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      
      const tempScanner = new Html5Qrcode('barcode-reader-temp', {
        formatsToSupport: [
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
        ],
        verbose: false,
      });

      // renderImage = false procesa la imagen en memoria sin renderizar en el DOM
      const decodedText = await tempScanner.scanFile(file, false);
      if (decodedText) {
        handleScanSuccess(decodedText);
      }
      try {
        await tempScanner.clear();
      } catch (cErr) {}
    } catch (err) {
      console.log('ZXing scanFile no encontró código, probando Quagga2 fallback...', err);
      try {
        const Quagga = (await import('@ericblade/quagga2')).default;
        const objectUrl = URL.createObjectURL(file);
        
        Quagga.decodeSingle(
          {
            src: objectUrl,
            numOfWorkers: 0,
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
          },
          (result) => {
            URL.revokeObjectURL(objectUrl);
            if (result && result.codeResult && result.codeResult.code) {
              handleScanSuccess(result.codeResult.code);
            } else {
              setErrorMessage('No se detectó un código de barras en la foto. Acércate más y enfoca con buena luz.');
            }
          }
        );
      } catch (fallbackErr) {
        console.error('Error procesando foto:', fallbackErr);
        setErrorMessage('No se detectó un código legible en la foto. Intenta nuevamente.');
      }
    } finally {
      setIsProcessingPhoto(false);
      e.target.value = '';
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
            ⚡ ZXing (Rápido)
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

      {/* Contenedor del Visor del Escáner */}
      <div className="scanner-container" style={{ position: 'relative', overflow: 'hidden', minHeight: '260px' }}>
        {/* Div para Html5Qrcode - Visible cuando está activo ZXing */}
        <div
          id="barcode-reader"
          style={{
            width: '100%',
            minHeight: isScanning && scannerEngine === 'zxing' ? '260px' : '0px',
            display: scannerEngine === 'zxing' && (isScanning || isStarting) ? 'block' : 'none',
          }}
        />

        {/* Div para Quagga2 - Visible cuando está activo Quagga */}
        <div
          ref={quaggaContainerRef}
          className="quagga-viewport"
          style={{
            width: '100%',
            minHeight: isScanning && scannerEngine === 'quagga' ? '260px' : '0px',
            display: scannerEngine === 'quagga' && (isScanning || isStarting) ? 'block' : 'none',
          }}
        />

        {/* Div oculto pero presente en el DOM para decodificación de fotos */}
        <div
          id="barcode-reader-temp"
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            opacity: 0,
            pointerEvents: 'none',
            overflow: 'hidden',
          }}
        />

        {/* Láser escáner animado cuando está activo */}
        {isScanning && <div className="scanner-laser-line" />}

        {/* Estado: Iniciando cámara */}
        {isStarting && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(10, 15, 29, 0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            backdropFilter: 'blur(4px)',
            padding: '20px',
            textAlign: 'center',
          }}>
            <div className="spinner" style={{ marginBottom: '16px' }} />
            <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Iniciando cámara...
            </p>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', maxWidth: '280px' }}>
              Concede permisos en tu navegador si aparece la solicitud.
            </p>
          </div>
        )}

        {/* Estado: Procesando foto */}
        {isProcessingPhoto && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(10, 15, 29, 0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            backdropFilter: 'blur(4px)',
            padding: '20px',
            textAlign: 'center',
          }}>
            <div className="spinner" style={{ marginBottom: '16px' }} />
            <p style={{ fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '4px' }}>
              Analizando código de barras...
            </p>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              Decodificando la imagen capturada.
            </p>
          </div>
        )}

        {/* Estado Inactivo (Cuando no está escaneando) */}
        {!isScanning && !isStarting && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '260px',
            padding: '24px',
            textAlign: 'center',
          }}>
            {errorMessage ? (
              <div style={{ maxWidth: '360px' }}>
                <i className="bi bi-exclamation-triangle-fill" style={{ fontSize: '2.5rem', color: 'var(--warning)', marginBottom: '12px', display: 'inline-block' }}></i>
                <h4 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  Aviso de Cámara
                </h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: '16px', lineHeight: 1.5 }}>
                  {errorMessage}
                </p>

                {/* Guía rápida para iPhone */}
                {isIOSDevice && (
                  <div style={{
                    background: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 14px',
                    textAlign: 'left',
                    marginBottom: '16px',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-secondary)',
                  }}>
                    <strong style={{ color: 'var(--accent-primary)', display: 'block', marginBottom: '6px' }}>
                      <i className="bi bi-apple"></i> En iPhone Safari:
                    </strong>
                    1. Toca <strong>aA</strong> en la barra de URL de Safari.<br />
                    2. Selecciona <strong>Configuración del sitio web</strong>.<br />
                    3. Cambia <strong>Cámara</strong> a <strong>Permitir</strong>.
                  </div>
                )}
              </div>
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

      {/* Selector de cámara si hay más de 1 lente disponible */}
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
              disabled={isStarting}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <i className="bi bi-camera-fill"></i> {isStarting ? 'Iniciando...' : 'Activar Cámara'}
            </button>
            <label
              className="btn btn-secondary btn-lg"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: isProcessingPhoto ? 'not-allowed' : 'pointer',
                margin: 0,
                opacity: isProcessingPhoto ? 0.7 : 1,
              }}
            >
              <i className="bi bi-camera"></i> {isProcessingPhoto ? 'Procesando...' : 'Tomar Foto'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={isProcessingPhoto}
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
