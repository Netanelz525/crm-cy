import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="card">
      <h1>כניסה למערכת</h1>
      <SignIn />
    </div>
  );
}

