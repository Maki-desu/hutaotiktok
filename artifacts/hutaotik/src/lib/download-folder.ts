import { Filesystem, Directory } from "@capacitor/filesystem";

let currentDirHandle: FileSystemDirectoryHandle | null = null;

export async function ensureStoragePermissions(): Promise<boolean> {
  try {
    const status = await Filesystem.checkPermissions();
    if (status.publicStorage !== "granted") {
      const request = await Filesystem.requestPermissions();
      return request.publicStorage === "granted";
    }
    return true;
  } catch {
    return true;
  }
}

export function getStoredFolderName(): string | null {
  return localStorage.getItem("hutaotik_download_folder_name");
}

export function setStoredFolderName(name: string): void {
  localStorage.setItem("hutaotik_download_folder_name", name);
}

export function clearStoredFolderName(): void {
  localStorage.removeItem("hutaotik_download_folder_name");
  currentDirHandle = null;
}

export function getDirHandle(): FileSystemDirectoryHandle | null {
  return currentDirHandle;
}

export function setDirHandle(handle: FileSystemDirectoryHandle | null): void {
  currentDirHandle = handle;
  if (handle?.name) {
    setStoredFolderName(handle.name);
  }
}

export async function createAndSetDeviceFolder(folderName: string): Promise<string> {
  await ensureStoragePermissions();
  const cleanName = folderName.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, " ") || "HutaoTik Downloads";

  try {
    await Filesystem.mkdir({
      path: cleanName,
      directory: Directory.Documents,
      recursive: true,
    });
  } catch {
    try {
      await Filesystem.mkdir({
        path: cleanName,
        directory: Directory.Cache,
        recursive: true,
      });
    } catch {
      /* ignore if directory already exists */
    }
  }

  setStoredFolderName(cleanName);
  return cleanName;
}

export async function openDeviceStorageFolderPicker(): Promise<string | null> {
  await ensureStoragePermissions();

  return new Promise((resolve) => {
    // Native Android Document Tree Intent bridge
    if (typeof window !== "undefined" && (window as any).AndroidStorageBridge?.openDeviceFolderPicker) {
      (window as any).onAndroidFolderPicked = (folderName: string) => {
        resolve(folderName || "HutaoTik Downloads");
      };
      try {
        (window as any).AndroidStorageBridge.openDeviceFolderPicker();
        return;
      } catch {
        /* fallback */
      }
    }

    if ("showDirectoryPicker" in window) {
      (window as any)
        .showDirectoryPicker({ mode: "readwrite" })
        .then((handle: FileSystemDirectoryHandle) => {
          if (handle) {
            setDirHandle(handle);
            resolve(handle.name);
          } else {
            resolve(null);
          }
        })
        .catch(() => resolve(null));
      return;
    }

    // Android device storage folder selector
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.style.display = "none";

    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        const firstFile = target.files[0];
        const relPath = firstFile.webkitRelativePath || firstFile.name;
        const pickedName = relPath.split("/")[0] || "HutaoTik Downloads";
        resolve(pickedName);
      } else {
        resolve(null);
      }
      if (document.body.contains(input)) {
        document.body.removeChild(input);
      }
    };

    document.body.appendChild(input);
    input.click();
  });
}

export async function promptSelectDirectory(): Promise<{ name: string; handle?: FileSystemDirectoryHandle } | null> {
  const pickedName = await openDeviceStorageFolderPicker();
  if (pickedName) {
    return { name: pickedName };
  }
  return null;
}

export async function saveBlobToDevice(blob: Blob, filename: string, folderName: string): Promise<void> {
  await ensureStoragePermissions();
  const cleanFolder = folderName.trim() || "HutaoTik Downloads";

  if (currentDirHandle) {
    try {
      const fileHandle = await currentDirHandle.getFileHandle(filename, { create: true });
      const writable = await (fileHandle as any).createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch {
      /* fallback to Capacitor Filesystem or Blob URL */
    }
  }

  // Convert Blob to Base64 for Capacitor Filesystem writing
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      const base64 = res.split(",")[1] || res;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  let savedLocally = false;

  try {
    await Filesystem.writeFile({
      path: `${cleanFolder}/${filename}`,
      data: base64Data,
      directory: Directory.Documents,
      recursive: true,
    });
    savedLocally = true;
  } catch {
    try {
      await Filesystem.writeFile({
        path: `${cleanFolder}/${filename}`,
        data: base64Data,
        directory: Directory.ExternalStorage,
        recursive: true,
      });
      savedLocally = true;
    } catch {
      /* fallback to browser blob link */
    }
  }

  if (!savedLocally) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export async function saveUrlToDevice(url: string, filename: string, folderName: string): Promise<void> {
  await ensureStoragePermissions();
  const cleanFolder = folderName.trim() || "HutaoTik Downloads";
  const path = `${cleanFolder}/${filename}`;

  try {
    await Filesystem.downloadFile({
      url,
      path,
      directory: Directory.Documents,
      recursive: true,
    });
    return;
  } catch {
    /* fallback to fetch blob */
  }

  const res = await fetch(url, { referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error("Server returned HTTP " + res.status);
  const blob = await res.blob();
  await saveBlobToDevice(blob, filename, folderName);
}
