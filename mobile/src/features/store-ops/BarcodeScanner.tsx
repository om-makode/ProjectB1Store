import { useRef, type ComponentType } from 'react';
import { Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { hasExpoModule } from '@/lib/nativeOptional';
import { spacing } from '@/theme/tokens';
import { Button, Sheet, Text } from '@/ui';

/**
 * Camera barcode scanning on phones/tablets. On the web the search field takes the barcode
 * instead (USB barcode scanners type the code and press Enter, so they work there too).
 */
export const canScanWithCamera = () => Platform.OS !== 'web' && hasExpoModule('ExpoCamera');

type CameraModule = typeof import('expo-camera');

function CameraScanner({ onScanned }: { onScanned: (code: string) => void }) {
  const { t } = useTranslation();
  // Loaded only when the native module exists (see canScanWithCamera).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cam = require('expo-camera') as CameraModule;
  const [permission, requestPermission] = cam.useCameraPermissions();
  const done = useRef(false);
  const CameraView = cam.CameraView as unknown as ComponentType<
    React.ComponentProps<CameraModule['CameraView']>
  >;

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={{ gap: spacing.md }}>
        <Text>{t('storeOps.stock.scanPermission')}</Text>
        <Button title={t('storeOps.stock.allowCamera')} onPress={() => void requestPermission()} />
      </View>
    );
  }
  return (
    <View style={{ height: 320, overflow: 'hidden', borderRadius: 12 }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
        }}
        onBarcodeScanned={(r) => {
          if (done.current || !r.data) return;
          done.current = true; // fires repeatedly while the code is in view
          onScanned(r.data);
        }}
      />
    </View>
  );
}

export function BarcodeScannerSheet({
  visible,
  onClose,
  onScanned,
}: {
  visible: boolean;
  onClose: () => void;
  onScanned: (code: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('storeOps.stock.scanTitle')}>
      {visible ? (
        canScanWithCamera() ? (
          <CameraScanner
            onScanned={(code) => {
              onScanned(code);
              onClose();
            }}
          />
        ) : (
          <Text color="textMuted">{t('storeOps.stock.scanUnavailable')}</Text>
        )
      ) : null}
    </Sheet>
  );
}
