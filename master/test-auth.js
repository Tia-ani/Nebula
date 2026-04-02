const auth = require('./auth');

async function testAuth() {
    console.log('🧪 Testing Postgres Auth System\n');

    try {
        // Test 1: Signup
        console.log('1️⃣  Testing signup...');
        const signupResult = await auth.signup('Test User', 'test@nebula.com', 'password123');
        if (signupResult.error) {
            console.log('❌ Signup failed:', signupResult.error);
        } else {
            console.log('✅ Signup successful');
            console.log('   Token:', signupResult.token.substring(0, 20) + '...');
            console.log('   User:', signupResult.user);
        }

        // Test 2: Login
        console.log('\n2️⃣  Testing login...');
        const loginResult = await auth.login('test@nebula.com', 'password123');
        if (loginResult.error) {
            console.log('❌ Login failed:', loginResult.error);
        } else {
            console.log('✅ Login successful');
            console.log('   User:', loginResult.user);
        }

        // Test 3: Verify Token
        console.log('\n3️⃣  Testing token verification...');
        const user = await auth.verifyToken(loginResult.token);
        if (user) {
            console.log('✅ Token verified');
            console.log('   User:', user);
        } else {
            console.log('❌ Token verification failed');
        }

        // Test 4: Get User Stats
        console.log('\n4️⃣  Testing get user stats...');
        const stats = await auth.getUserStats('test@nebula.com');
        console.log('✅ Stats retrieved');
        console.log('   Stats:', stats);

        // Test 5: Update Credits (add)
        console.log('\n5️⃣  Testing credit addition...');
        await auth.updateUserCredits('test@nebula.com', 50, 'add');
        const statsAfterAdd = await auth.getUserStats('test@nebula.com');
        console.log('✅ Credits added');
        console.log('   New balance:', statsAfterAdd.credits);

        // Test 6: Update Credits (subtract)
        console.log('\n6️⃣  Testing credit deduction...');
        await auth.updateUserCredits('test@nebula.com', 20, 'subtract');
        const statsAfterSubtract = await auth.getUserStats('test@nebula.com');
        console.log('✅ Credits deducted');
        console.log('   New balance:', statsAfterSubtract.credits);

        // Test 7: Select Role
        console.log('\n7️⃣  Testing role selection...');
        const roleResult = await auth.selectRole('test@nebula.com', 'developer');
        if (roleResult.error) {
            console.log('❌ Role selection failed:', roleResult.error);
        } else {
            console.log('✅ Role updated to developer');
        }

        // Test 8: Superuser Stats
        console.log('\n8️⃣  Testing superuser stats...');
        const superStats = await auth.getSuperuserStats();
        console.log('✅ Superuser stats retrieved');
        console.log('   Stats:', superStats);

        // Test 9: Duplicate Signup (should fail)
        console.log('\n9️⃣  Testing duplicate signup (should fail)...');
        const dupResult = await auth.signup('Test User 2', 'test@nebula.com', 'password456');
        if (dupResult.error) {
            console.log('✅ Duplicate signup correctly rejected:', dupResult.error);
        } else {
            console.log('❌ Duplicate signup should have failed!');
        }

        // Test 10: Wrong Password (should fail)
        console.log('\n🔟 Testing wrong password (should fail)...');
        const wrongPassResult = await auth.login('test@nebula.com', 'wrongpassword');
        if (wrongPassResult.error) {
            console.log('✅ Wrong password correctly rejected:', wrongPassResult.error);
        } else {
            console.log('❌ Wrong password should have failed!');
        }

        console.log('\n✅ All tests completed!');
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Test failed with error:', error);
        process.exit(1);
    }
}

testAuth();
