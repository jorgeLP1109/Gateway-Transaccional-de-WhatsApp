import 'dotenv/config';

const apiKey = process.env.API_SECRET_KEY;
if (!apiKey) {
  console.error('Falta API_SECRET_KEY. Configúrala en el entorno o en .env.');
  process.exit(1);
}

const payload = {
  clientId: 'test-client',
  phone: '584227500892',
  message: 'Tu código OTP de prueba es 123456. No lo compartas con nadie.',
};

try {
  const response = await fetch('http://localhost:3000/api/v1/send-message', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json();
  console.log(`HTTP ${response.status}`);
  console.log(JSON.stringify(responseBody, null, 2));

  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.error('No se pudo completar la petición al Gateway:', error.message);
  process.exitCode = 1;
}
