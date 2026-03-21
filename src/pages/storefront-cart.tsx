import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import FullScreenLoader from "../components/FullScreenLoader";
import { usePageMeta } from "../hooks/usePageMeta";

export default function StorefrontCart() {
  usePageMeta({
    title: "StoreFront Cart | Your Social Place",
    description: "Reserved storefront items waiting for checkout.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const navigate = useNavigate();

  useEffect(() => {
    navigate("/storefront?cart=1", { replace: true });
  }, [navigate]);

  return <FullScreenLoader label="Opening cart" />;
}
