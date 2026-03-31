import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { MercadoPagoConfig, Payment } from 'mercadopago';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());

  // Mercado Pago Configuration
  const client = new MercadoPagoConfig({ 
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || '',
    options: { timeout: 5000 }
  });
  const payment = new Payment(client);

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Create Pix Payment
  app.post("/api/payment/create", async (req, res) => {
    try {
      if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
        return res.status(500).json({ 
          error: "Configuração incompleta: O token do Mercado Pago (MERCADO_PAGO_ACCESS_TOKEN) não foi configurado nos Secrets do AI Studio." 
        });
      }

      const { email, planId } = req.body;

      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      let amount = 0.50;
      let description = 'Créditos Avulsos - Veo 3 Architect';

      if (planId === 'pro') {
        amount = 29.90;
        description = 'Plano PRO Mensal - Veo 3 Architect';
      } else if (planId === 'business') {
        amount = 99.90;
        description = 'Plano BUSINESS Mensal - Veo 3 Architect';
      }

      const body = {
        transaction_amount: amount,
        description: description,
        payment_method_id: 'pix',
        payer: {
          email: email,
        },
      };

      const result = await payment.create({ body });
      
      res.json({
        id: result.id,
        status: result.status,
        qr_code: result.point_of_interaction?.transaction_data?.qr_code,
        qr_code_base64: result.point_of_interaction?.transaction_data?.qr_code_base64,
      });
    } catch (error: any) {
      console.error("Error creating payment:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Check Payment Status
  app.get("/api/payment/status/:id", async (req, res) => {
    try {
      if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
        return res.status(500).json({ error: "MERCADO_PAGO_ACCESS_TOKEN is missing" });
      }
      const { id } = req.params;
      const result = await payment.get({ id });
      res.json({ status: result.status });
    } catch (error: any) {
      console.error("Error fetching payment status:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
