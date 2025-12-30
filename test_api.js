
const BASE_URL = 'http://localhost:5000/api';
let accessToken = '';
let refreshToken = '';
let userId = '';

const uniqueId = Date.now().toString().slice(-4);
const testUser = {
  username: `testuser_${uniqueId}`,
  email: `test_${uniqueId}@example.com`,
  password: 'password123'
};

const runTest = async (name, fn) => {
  try {
    process.stdout.write(`Testing: ${name}... `);
    await fn();
    console.log('✅ PASS');
  } catch (error) {
    console.log('❌ FAIL');
    console.error(`Error: ${error.message}`);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response, null, 2));
    }
  }
};

const request = async (endpoint, options = {}) => {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (accessToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.message || 'Request failed');
    error.response = data;
    throw error;
  }

  return data;
};

const main = async () => {
  console.log('🚀 Starting API Tests...\n');

  await runTest('Health Check', async () => {
    const data = await request('/health');
    if (!data.success) throw new Error('Health check failed');
  });

  await runTest('Register User', async () => {
    const data = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(testUser)
    });
    
    if (!data.data.accessToken) throw new Error('No access token received');
    accessToken = data.data.accessToken;
    refreshToken = data.data.refreshToken;
    userId = data.data.user._id;
  });

  await runTest('Login User', async () => {
    // Clear tokens to test login fresh
    accessToken = ''; 
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password
      })
    });
    
    accessToken = data.data.accessToken;
    refreshToken = data.data.refreshToken;
  });

  await runTest('Get Profile', async () => {
    const data = await request('/user/profile');
    if (data.data.user.email !== testUser.email) throw new Error('Profile email mismatch');
  });

  await runTest('Update Profile', async () => {
    const newCountry = 'ChessLand';
    const data = await request('/user/profile', {
      method: 'PUT',
      body: JSON.stringify({ country: newCountry })
    });
    
    if (data.data.user.country !== newCountry) throw new Error('Profile update failed');
  });

  await runTest('Access Protected Route', async () => {
    await request('/auth/verify');
  });

  await runTest('Refresh Token', async () => {
    // Save old access token
    const oldToken = accessToken;
    
    const data = await request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken })
    });
    
    if (!data.data.accessToken) throw new Error('No new access token');
    if (data.data.accessToken === oldToken) throw new Error('Token did not change');
    
    accessToken = data.data.accessToken;
  });

  await runTest('Logout', async () => {
    await request('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }) // Technically not needed for endpoint but good practice
    });
  });

  await runTest('Verify Logout (Expect Fail)', async () => {
    // Should fail with old refresh token on logout (if we were using token rotation/blocklisting fully)
    // But our logout deletes ALL refresh tokens for user.
    // Let's check verify endpoint using the access token - wait, access token is stateless and valid for 3h.
    // So verify using access token will STILL WORK until it expires.
    // This is expected behavior for JWTs unless we check db for every request (which we check user existence, but not token existence for verified routes).
    // The logout only kills refresh ability.
    
    // So let's test that we CANNOT refresh token anymore
    try {
      await request('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken })
      });
      throw new Error('Refresh should have failed after logout');
    } catch (e) {
      if (e.message !== 'Invalid or expired refresh token') throw e;
      // This is success - we WANT it to fail
    }
  });

  console.log('\n✨ All tests completed!');
};

main();
