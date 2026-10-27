export default function PlayerAvatar({
  name,
  avatar,
  className = "",
}: {
  name: string;
  avatar?: string;
  className?: string;
}) {
  return (
    <span className={`person-avatar ${className}`} aria-hidden="true">
      {avatar ? (
        <img
          src={
            avatar.startsWith("/avatars/")
              ? avatar
                  .replace("/avatars/", "/optimized/avatars/")
                  .replace(/\.png$/, ".webp")
              : avatar
          }
          alt=""
          width={112}
          height={112}
          decoding="async"
        />
      ) : (
        <span>{name.trim().charAt(0).toUpperCase() || "?"}</span>
      )}
    </span>
  );
}
