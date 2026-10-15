// Tells the poet why a draft change was refused. Renders nothing when there is nothing to say.
export default function RefusalAlert({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <span role="alert" className="DraftRefusal">
      {message}
    </span>
  );
}
