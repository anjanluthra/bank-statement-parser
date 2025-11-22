export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, content } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: type === 'pdf' ? [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: content
              }
            },
            {
              type: 'text',
              text: `Extract ALL transactions from this bank statement. Return ONLY a JSON array.

Format:
[
  {
    "date": "YYYY-MM-DD",
    "description": "transaction description",
    "amount": -123.45,
    "balance": 1000.00,
    "type": "debit"
  }
]

Rules:
- Negative for money OUT
- Positive for money IN
- Return ONLY JSON array`
            }
          ] : `Parse this CSV bank statement. Return ONLY a JSON array.

CSV Data:
${content}

Format:
[
  {
    "date": "YYYY-MM-DD",
    "description": "merchant",
    "amount": -123.45,
    "balance": 1000.00,
    "type": "debit"
  }
]

Return ONLY JSON array`
        }]
      })
    });

    const data = await response.json();
    
    if (!data.content || !data.content[0]) {
      throw new Error('No response from AI');
    }

    let responseText = data.content[0].text.trim();
    responseText = responseText.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    
    const jsonMatch = responseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      responseText = jsonMatch[0];
    }
    
    const transactions = JSON.parse(responseText).map(t => ({
      date: t.date || 'Unknown',
      description: t.description || 'No description',
      amount: parseFloat(t.amount) || 0,
      balance: t.balance ? parseFloat(t.balance) : null,
      type: t.type || (t.amount < 0 ? 'debit' : 'credit')
    }));

    res.status(200).json({ success: true, transactions });
  } catch (error) {
    console.error('Extraction error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}