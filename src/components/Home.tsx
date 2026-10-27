"use client";
import {
  ChevronRight,
  Gamepad2,
  Link2,
  Play,
  Plus,
  ShieldCheck,
  UsersRound,
  Zap,
  Swords,
} from "lucide-react";
import RoomInviteCard from "./RoomInviteCard";

const features = [
  {
    icon: UsersRound,
    title: "Salas privadas por código",
    text: "Crie uma sala e convide seus amigos. Eles entram sem criar conta.",
  },
  {
    icon: Gamepad2,
    title: "Teclado ou gamepad",
    text: "Jogue no celular, teclado ou controle USB e Bluetooth.",
  },
  {
    icon: ShieldCheck,
    title: "Clássico de verdade",
    text: "A ROM fica com o anfitrião. A diversão chega a todos.",
  },
  {
    icon: Zap,
    title: "Multiplayer remoto",
    text: "A mesma experiência do sofá, agora de qualquer lugar.",
  },
];
const steps = [
  {
    icon: Swords,
    title: "Crie uma sala",
    text: "O anfitrião inicia o jogo e gera um código de sala.",
  },
  {
    icon: UsersRound,
    title: "Convide seus amigos",
    text: "Compartilhe o código e joguem juntos, de onde estiverem.",
  },
  {
    icon: Play,
    title: "Comece a diversão",
    text: "Exploda seus oponentes e mostre quem é o verdadeiro campeão!",
  },
];
export default function Home({
  onCreate,
  onJoin,
  onSolo,
  netplay = false,
}: {
  onCreate: () => void;
  onJoin: () => void;
  onSolo: () => void;
  netplay?: boolean;
}) {
  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <p className="eyebrow">SEU CLÁSSICO. SUA TURMA.</p>
          <h1 id="home-title">
            A próxima partida
            <br />é com <em>seus amigos.</em>
          </h1>
          <p className="intro">
            Reviva a diversão do Super Nintendo{" "}
            {netplay
              ? "com emulação local em cada aparelho."
              : "em multiplayer remoto."}
            <br className="desktop-break" /> Cinco mundos, infinitas
            rivalidades. O Super Bomberman 5 encontra a sua próxima noite de
            jogos.
          </p>
          <div className="game-summary">
            <span className="game-badge" aria-hidden="true">
              <Gamepad2 size={32} />
            </span>
            <div>
              <div className="game-tags">
                <span>SUPER NINTENDO</span>
                <span>1997</span>
                <span>{netplay ? "NETPLAY" : "REMOTE PLAY"}</span>
              </div>
              <h2>Super Bomberman 5</h2>
              <p className="game-edition">
                Edição japonesa · Jogo original via emulação
              </p>
            </div>
          </div>
          <div className="actions hero-actions">
            <button
              className="primary create-action"
              onClick={onCreate}
              aria-label="＋ Criar sala"
            >
              <Plus size={24} aria-hidden="true" />
              <span>Criar sala</span>
              <ChevronRight size={20} aria-hidden="true" />
            </button>
            <button
              className="join-action"
              onClick={onJoin}
              aria-label="Entrar em sala ↗"
            >
              <Link2 size={23} aria-hidden="true" />
              <span>Entrar em sala</span>
            </button>
            <button
              className="text-button solo-action"
              onClick={onSolo}
              aria-label="▷ Jogar sozinho"
            >
              <Play size={24} aria-hidden="true" />
              <span>Jogar sozinho</span>
            </button>
          </div>
        </div>
        <div className="hero-art">
          <div className="console-halo" aria-hidden="true" />
          <div className="console-back" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="console-frame">
            <div className="console-screen">
              <img
                src="/optimized/bomberman-battle.webp"
                alt="Arte de Super Bomberman 5 com Bomberman, seus amigos e bombas em uma arena colorida"
                width={1200}
                height={675}
                fetchPriority="high"
                decoding="async"
              />
            </div>
          </div>
          <RoomInviteCard />
        </div>
      </section>
      <section className="feature-grid" aria-label="Jogar do seu jeito">
        {features.map(({ icon: Icon, title, text }) => (
          <article key={title}>
            <span className="feature-icon" aria-hidden="true">
              <Icon size={30} />
            </span>
            <div>
              <h3>{title}</h3>
              <p>
                {netplay && title === "Clássico de verdade"
                  ? "Cada jogador importa sua ROM e executa o jogo no próprio aparelho."
                  : text}
              </p>
            </div>
          </article>
        ))}
      </section>
      <section className="how-it-works" aria-labelledby="how-title">
        <div className="how-heading">
          <h2 id="how-title">
            COMO
            <br />
            FUNCIONA?
          </h2>
          <p>É rápido e simples.</p>
        </div>
        <ol>
          {steps.map(({ icon: Icon, title, text }, index) => (
            <li key={title}>
              <span className="step-number" aria-hidden="true">
                {index + 1}
              </span>
              <Icon className="step-icon" size={30} aria-hidden="true" />
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
              {index < 2 && (
                <ChevronRight
                  className="step-chevron"
                  size={24}
                  aria-hidden="true"
                />
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
