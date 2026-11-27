import { useState } from "react";
import { Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TaoCompressorSection } from "@/components/tao-compressor";
import { getStoredFolderName, openDeviceStorageFolderPicker, createAndSetDeviceFolder } from "@/lib/download-folder";
import { useToast } from "@/hooks/use-toast";

export default function TaotoolsPage() {
  const [folderName, setFolderName] = useState<string | null>(getStoredFolderName() || "HutaoTik Downloads");
  const { toast } = useToast();

  const handleOpenFolderPicker = async () => {
    const selected = await openDeviceStorageFolderPicker();
    if (selected) {
      await createAndSetDeviceFolder(selected);
      setFolderName(selected);
      toast({
        title: "Download Location Updated",
        description: `Folder set to: ${selected}`,
      });
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="animate-bounce-pop flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-syne font-bold flex items-center gap-2">
            <Wand2 className="w-6 h-6 text-primary animate-pulse" />
            <span>Taotools Suite</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Video compression and media utilities.
          </p>
        </div>
        <Badge variant="outline" className="bg-primary/10 border-primary/30 text-primary font-bold">
          Tao Suite
        </Badge>
      </div>

      <TaoCompressorSection
        folderName={folderName}
        onOpenFolderPicker={handleOpenFolderPicker}
      />
    </div>
  );
}
