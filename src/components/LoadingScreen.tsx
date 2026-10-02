import AppImage from "@/components/shared/AppImage";
import { getLogoImage } from "@/utils/logoUtils";

interface LoadingScreenProps {
  visible: boolean;
  backgroundColor?: string;
  headerLogoImageName?: string;
}

export default function LoadingScreen({ visible, headerLogoImageName }: LoadingScreenProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-base-200" style={{ zIndex: 999999999 }}>
      <div className="shadow-2xl rounded-2xl bg-base-100 p-8 flex flex-col items-center gap-6 w-[90vw] max-w-xl">
        {/* iMAPS logo on top (its PNG has wide transparent margins, so it needs a big box), with the
            configured header logo underneath once config has loaded */}
        <div className="flex flex-col items-center justify-center w-full gap-4">
          <div className="relative h-44 w-64 sm:h-56 sm:w-80 flex-shrink-0">
            <AppImage src="/images/imaplogo.png" alt="iMAPS" className="absolute inset-0 h-full w-full object-contain" />
          </div>
          {headerLogoImageName && <AppImage src={getLogoImage(headerLogoImageName)} alt="Logo Image" className="h-16 sm:h-20 w-auto max-w-[320px] object-contain dark:invert" />}
        </div>

        {/* Spinner */}
        <span className="loading loading-spinner loading-lg text-primary"></span>

        {/* Loading text */}
        <p className="text-base-content/70 text-sm">Loading Application</p>
      </div>
    </div>
  );
}
