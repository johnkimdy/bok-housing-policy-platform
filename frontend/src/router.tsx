import { createBrowserRouter, Navigate } from "react-router-dom";
import AuthCallback from "./AuthCallback";
import AppLayout from "./components/layout/AppLayout";
import ScenarioBuilder from "./pages/ScenarioBuilder";
import Projections from "./pages/Projections";
import PolicyBriefs from "./pages/PolicyBriefs";
import AiAdvisor from "./pages/AiAdvisor";

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <AppLayout />,
      children: [
        { index: true, element: <Navigate to="/scenarios" replace /> },
        { path: "scenarios", element: <ScenarioBuilder /> },
        { path: "projections", element: <Projections /> },
        { path: "briefs", element: <PolicyBriefs /> },
        { path: "advisor", element: <AiAdvisor /> },
      ],
    },
    { path: "/auth/callback", element: <AuthCallback /> },
  ],
  { basename: import.meta.env.BASE_URL },
);

export default router;
