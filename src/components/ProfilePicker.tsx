"use client";
import { useEffect, useRef, useState } from "react";
import { PRESET_PROFILES, type PlayerProfile } from "@/lib/profiles";
import { avatarSchema } from "@/lib/protocol";
import PlayerAvatar from "./PlayerAvatar";
const STORAGE = "bomber.profiles";
const MAX_CUSTOM = 12;

async function avatarFromFile(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("Escolha uma foto JPG, PNG ou WebP.");
  if (file.size > 8 * 1024 * 1024) throw Error("Escolha uma foto de até 8 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Não foi possível preparar a foto.");
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      128,
      128,
    );
    const data = canvas.toDataURL("image/jpeg", 0.76);
    if (!avatarSchema.safeParse(data).success)
      throw Error("A foto ficou muito grande. Escolha outra imagem.");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ProfilePicker({
  name,
  avatar,
  onSelect,
}: {
  name: string;
  avatar?: string;
  onSelect: (profile: PlayerProfile) => void;
}) {
  const [custom, setCustom] = useState<PlayerProfile[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [photo, setPhoto] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "[]");
      if (Array.isArray(saved))
        setCustom(
          saved
            .filter(
              (p) =>
                p &&
                typeof p.id === "string" &&
                p.id.startsWith("custom-") &&
                typeof p.name === "string" &&
                p.name.trim().length > 0 &&
                p.name.length <= 24 &&
                (!p.avatar || avatarSchema.safeParse(p.avatar).success),
            )
            .slice(0, MAX_CUSTOM),
        );
    } catch {}
    return () => {
      generation.current++;
    };
  }, []);
  function add() {
    const trimmed = newName.trim();
    if (!trimmed) {
      setError("Digite o nome da pessoa.");
      return;
    }
    if (
      [...PRESET_PROFILES, ...custom].some(
        (p) =>
          p.name.toLocaleLowerCase("pt-BR") ===
          trimmed.toLocaleLowerCase("pt-BR"),
      )
    ) {
      setError("Esse nome já está na lista. Selecione o perfil acima.");
      return;
    }
    if (custom.length >= MAX_CUSTOM) {
      setError("Você já adicionou 12 pessoas neste navegador.");
      return;
    }
    const profile = {
      id: `custom-${crypto.randomUUID()}`,
      name: trimmed,
      avatar: photo,
    };
    const next = [...custom, profile];
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next));
    } catch {
      setError(
        "Não foi possível salvar o perfil neste navegador. Libere espaço e tente novamente.",
      );
      return;
    }
    setCustom(next);
    onSelect(profile);
    setAdding(false);
    setNewName("");
    setPhoto(undefined);
    setError("");
  }
  async function choose(file?: File) {
    if (!file) return;
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const data = await avatarFromFile(file);
      if (current === generation.current) setPhoto(data);
    } catch (e) {
      if (current === generation.current)
        setError(
          e instanceof Error ? e.message : "Não foi possível abrir a foto.",
        );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <fieldset className="identity-picker">
      <legend>Quem vai jogar?</legend>
      <p className="identity-hint">
        Escolha seu perfil ou adicione alguém à turma.
      </p>
      <div className="profile-grid">
        {[...PRESET_PROFILES, ...custom].map((profile) => (
          <button
            type="button"
            key={profile.id}
            className="profile-choice"
            aria-label={`Jogar como ${profile.name}`}
            aria-pressed={name === profile.name && avatar === profile.avatar}
            onClick={() => {
              onSelect(profile);
              setAdding(false);
              setError("");
            }}
          >
            <PlayerAvatar name={profile.name} avatar={profile.avatar} />
            <strong>{profile.name}</strong>
            {profile.id === "helo" && !profile.avatar && (
              <small>Foto em breve</small>
            )}
          </button>
        ))}
        <button
          type="button"
          className="profile-choice profile-add-choice"
          aria-label="Adicionar pessoa"
          aria-expanded={adding}
          onClick={() => {
            setAdding(!adding);
            setError("");
          }}
        >
          <span className="person-avatar">＋</span>
          <strong>Adicionar pessoa</strong>
        </button>
      </div>
      {adding && (
        <div
          className="profile-add-form"
          role="group"
          aria-label="Adicionar pessoa"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (!busy) add();
            }
          }}
        >
          <label>
            Nome da pessoa
            <input
              autoFocus
              value={newName}
              maxLength={24}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Como a pessoa se chama?"
            />
          </label>
          <div className="profile-photo-upload">
            <PlayerAvatar name={newName} avatar={photo} />
            <label>
              Foto (opcional)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => void choose(e.target.files?.[0])}
              />
            </label>
          </div>
          {error && (
            <p className="profile-error" role="alert">
              {error}
            </p>
          )}
          <p className="subtle">
            O perfil fica salvo neste navegador. Ao entrar, sua foto também
            aparece para a sala.
          </p>
          <div className="profile-add-actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={add}
            >
              {busy ? "Preparando foto…" : "Salvar e selecionar"}
            </button>
            <button
              type="button"
              onClick={() => {
                generation.current++;
                setBusy(false);
                setAdding(false);
                setError("");
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
