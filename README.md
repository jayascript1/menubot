# MenuBot - AI-Powered Menu Health Recommender

A React Native app that analyzes restaurant menus using AI vision to provide healthy food recommendations. Point your camera at a menu, snap a photo, and get instant health insights with costs and macros.

## Features

- 📸 **Camera Integration**: Take photos of menus directly in the app
- 🤖 **AI Analysis**: Uses OpenAI's GPT-5 Vision to extract menu items and nutrition info
- 🥗 **Health Scoring**: Ranks menu items by healthiness
- 💡 **Smart Pairings**: Suggests healthy meal combinations
- 🔊 **Voice Guidance**: Text-to-speech for hands-free operation
- 💰 **Cost Analysis**: Shows prices and total costs for combinations
- 📱 **Cross-Platform**: Works on iOS, Android, and Web

## Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- OpenAI API key (for AI analysis)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd menubot
```

2. Install dependencies:
```bash
npm install
```

3. Set up your OpenAI API key:
   - Get an API key from [OpenAI Platform](https://platform.openai.com/api-keys)
   - Create a `.env` file in the project root with your API key:
   ```bash
   cp .env.example .env
   # Edit .env and replace "your_openai_api_key_here" with your actual API key
   ```
   - Or set as environment variable:
   ```bash
   export EXPO_PUBLIC_OPENAI_API_KEY="sk-your-key-here"
   ```

### Running the App

#### Web (Recommended for development)
```bash
npm run web
```

#### iOS Simulator
```bash
npm run ios
```

#### Android Emulator
```bash
npm run android
```

#### Expo Go (Mobile)
```bash
npm start
```
Then scan the QR code with Expo Go app.

## Usage

1. **Setup**: Enter your OpenAI API key in the developer section
2. **Capture**: Tap "Take Menu Photo" to capture a menu image
3. **Analyze**: Tap "Analyse" to process the image with AI
4. **Review**: View health rankings, smart pairings, and nutrition info
5. **Listen**: Tap "Read Aloud" for voice guidance

## Mock Mode

If you don't have an API key, you can use the "Run Mock Analysis" button to see how the app works with sample data.

## Technical Details

- **Framework**: React Native with Expo SDK 51
- **AI**: OpenAI GPT-5 Vision for menu analysis
- **TTS**: OpenAI TTS for voice guidance
- **Platforms**: iOS, Android, Web
- **Architecture**: Single-file prototype with dynamic imports

## Environment Variables

The app uses environment variables for configuration. Create a `.env` file in the project root:

```bash
# .env
EXPO_PUBLIC_OPENAI_API_KEY=your_actual_api_key_here
```

**Note**: Variables prefixed with `EXPO_PUBLIC_` are exposed to the client-side code. This is fine for prototyping but not recommended for production.

## Security Notes

⚠️ **Important**: This is a prototype app. For production use:
- Never ship API keys in client apps
- Move AI calls to a secure backend
- Implement proper user authentication
- Add rate limiting and usage tracking

## Development

The app is structured as a single TypeScript file (`menubot.ts`) for rapid prototyping. Key components:

- **Image Picker**: Camera integration with permissions
- **AI Analysis**: OpenAI API integration for menu parsing
- **Health Scoring**: Algorithm-based nutrition ranking
- **UI Components**: React Native components with dark theme

## Troubleshooting

- **Camera Permissions**: Ensure camera access is granted
- **API Key**: Verify your OpenAI API key is valid and has sufficient credits
- **Web Compatibility**: Some features may work differently in web vs mobile
- **Network Issues**: Check your internet connection for AI analysis

## License

This project is for educational and prototyping purposes.
