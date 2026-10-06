import { type Request, type Response } from 'express';
import { User } from '../../../models';
import { isExpoPushToken } from '../../../util/expo';

export const updatePushToken = async (req: Request, res: Response) => {
    const { pushToken } = req.body;
    const userId = req.params.userId;
    
    if(!isExpoPushToken(pushToken)) {
        return void res.status(400).json({ error: 'Invalid push token' });
    }
    try {
        const user = await User.findByIdAndUpdate(userId,{ pushToken }, { new: true });
        const updatedUser = {
          ...user,
          currentRefreshJti: '<REDACTED/>',
          currentRefreshExpiresAt: '<REDACTED/>',
        }
        res.status(200).json({ user: updatedUser, ok: true });
    } catch(err) {
        console.log(err);
        res.status(500).json({ error: 'Internal server error', ok: false });
    }
}