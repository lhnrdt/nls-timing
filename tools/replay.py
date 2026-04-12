#!/usr/bin/env python3
"""
WebSocket Data Replay Server - Schema-Based Format v3.

Replays recorded WebSocket messages with original timing for development.
Uses schema-based compression for ultra-compact storage.
"""

import asyncio
import json
import sys
import argparse
from pathlib import Path
import websockets
from websockets.server import serve

# Import schema handler
from advanced_format import AdvancedRecordingFormat


# Configuration
REPLAY_PORT = 9000
REPLAY_SPEED = 1.0  # 1.0 = real-time, 0.5 = half speed, 2.0 = double speed


class WebSocketReplayServer:
    """Manages WebSocket replay server and connected clients."""

    def __init__(self, data_file: str, speed: float = 1.0, port: int = REPLAY_PORT):
        """
        Initialize replay server.

        Args:
            data_file: Path to JSON file with recorded messages
            speed: Playback speed multiplier
            port: WebSocket port to listen on
        """
        self.data_file = Path(data_file)
        self.speed = speed
        self.port = port
        self.metadata = {}
        self.messages = []
        self.is_playing = False
        self.clients = set()
        self.replay_tasks = set()
        self.shutdown_event = asyncio.Event()

    def load_data(self) -> bool:
        """Load recorded messages from schema registry format."""
        try:
            file_path = str(self.data_file)
            print(f'Loading schema registry format from {file_path}...')
            
            formatter = AdvancedRecordingFormat()
            
            with open(file_path, 'r') as f:
                lines = f.readlines()
            
            if not lines:
                print('Error: Empty file')
                return False
            
            # Parse header
            header = json.loads(lines[0])
            print(f'Format: {header.get("format", "unknown")} v{header.get("version")}')
            
            # Load schema registry from header
            if 'schemas' in header:
                formatter.set_schema_registry(header['schemas'])
                schema_count = len(header['schemas']) if isinstance(header['schemas'], list) else len(header['schemas'])
                print(f'Loaded {schema_count} schemas from header')
            
            # Load nested schema registry from header
            if 'nestedSchemas' in header:
                nested_registry = {}
                for nested_id_str, field_list in header['nestedSchemas'].items():
                    nested_registry[int(nested_id_str)] = field_list
                formatter.set_nested_schema_registry(nested_registry)
                print(f'Loaded {len(nested_registry)} nested schemas from header')
            
            # Parse messages
            self.messages = []
            current_time = 0
            error_count = 0
            
            for idx, line in enumerate(lines[1:], 1):
                if not line.strip():
                    continue
                
                try:
                    msg_entry = json.loads(line)
                    if isinstance(msg_entry, list) and len(msg_entry) == 2:
                        delta_ms, compressed = msg_entry
                        current_time += delta_ms
                        
                        # Decompress message
                        data = formatter.decompress(compressed)
                        if not data:
                            error_count += 1
                            print(f'  Line {idx}: Failed to decompress (returned empty dict)')
                            continue
                        
                        self.messages.append({
                            'timestamp': current_time / 1000.0,
                            'data': data
                        })
                    else:
                        error_count += 1
                        print(f'  Line {idx}: Unexpected format')
                except json.JSONDecodeError as e:
                    error_count += 1
                    print(f'  Line {idx}: JSON decode error: {e}')
                except Exception as e:
                    error_count += 1
                    print(f'  Line {idx}: Unexpected error: {e}')
            
            print(f'Loaded {len(self.messages)} messages from {file_path} ({error_count} errors)')
            return len(self.messages) > 0
        except Exception as e:
            print(f'Error loading data: {e}')
            return False

    async def broadcast_message(self, message):
        """Send message to all connected clients."""
        if self.clients:
            # Convert message to JSON string if it's a dict
            if isinstance(message, dict):
                message_str = json.dumps(message, separators=(',', ':'))
            else:
                message_str = message
            
            for client in self.clients:
                try:
                    await client.send(message_str)
                except Exception as e:
                    print(f'Error sending to client: {e}')

    async def replay_messages(self):
        """Replay all recorded messages with timing."""
        if not self.messages:
            print('No messages to replay')
            return

        print(f'Starting replay (speed: {self.speed}x)...')
        self.is_playing = True
        
        try:
            for i, msg_entry in enumerate(self.messages):
                # Check for shutdown signal
                if self.shutdown_event.is_set():
                    print('Replay interrupted by shutdown')
                    break

                if not self.clients:
                    print('No clients connected, pausing replay...')
                    break

                # Wait for the appropriate time before sending
                if i > 0:
                    prev_timestamp = self.messages[i - 1]['timestamp']
                    curr_timestamp = msg_entry['timestamp']
                    delay = (curr_timestamp - prev_timestamp) / self.speed
                    await asyncio.sleep(max(0.01, delay))

                # Send message to all clients
                await self.broadcast_message(msg_entry['data'])

                if (i + 1) % 50 == 0:
                    print(f'  Sent {i + 1}/{len(self.messages)} messages')

            print('Replay finished!')
            self.is_playing = False

        except asyncio.CancelledError:
            print('Replay task cancelled')
            self.is_playing = False
        except Exception as e:
            print(f'Error during replay: {e}')
            self.is_playing = False

    async def handle_client(self, websocket, path: str):
        """Handle new WebSocket client connection."""
        print(f'Client connected from {websocket.remote_address}')
        self.clients.add(websocket)
        
        # Restart replay from beginning when a new client connects
        print('Restarting replay from beginning for new client...')
        # Cancel any existing replay tasks
        for task in self.replay_tasks:
            task.cancel()
        self.replay_tasks.clear()
        
        # Start new replay from the beginning
        task = asyncio.create_task(self.replay_messages())
        self.replay_tasks.add(task)
        task.add_done_callback(self.replay_tasks.discard)

        try:
            # Wait for client initialization message
            init_message = await asyncio.wait_for(websocket.recv(), timeout=5.0)
            print(f'Received init from client: {init_message[:100]}...')
            
            # Parse init message to get client info
            try:
                init_data = json.loads(init_message)
                client_local_time = init_data.get('clientLocalTime', 0)
                event_id = init_data.get('eventId', '20')
                
                # Respond with TIMESYNC (matching real server behavior)
                timesync_response = {
                    "eventId": event_id,
                    "eventPid": init_data.get('eventPid', [0, 4]),
                    "clientLocalTime": client_local_time,
                    "PID": "LTS_TIMESYNC",
                    "serverLocalTime": int(__import__('datetime').datetime.now().timestamp() * 1000)
                }
                await websocket.send(json.dumps(timesync_response, separators=(',', ':')))
                print('Sent TIMESYNC response')
            except json.JSONDecodeError:
                print('Invalid init message format')
                return
            
            # Now continue to listen for any other messages (shouldn't be many)
            async for message in websocket:
                print(f'Received from client: {message[:100]}...')

        except asyncio.TimeoutError:
            print('No init message received from client, disconnecting')
        except Exception as e:
            print(f'Client error: {e}')
        finally:
            self.clients.discard(websocket)
            print(f'Client disconnected. {len(self.clients)} clients remaining.')
            # If clients remain, restart replay for them
            if self.clients:
                print('Restarting replay for remaining clients...')
                for task in self.replay_tasks:
                    task.cancel()
                self.replay_tasks.clear()
                task = asyncio.create_task(self.replay_messages())
                self.replay_tasks.add(task)
                task.add_done_callback(self.replay_tasks.discard)

    async def start_server(self):
        """Start the WebSocket replay server."""
        print(f'Starting WebSocket replay server on ws://0.0.0.0:{self.port}')
        print(f'Connect your app to: ws://localhost:{self.port}')

        async with serve(self.handle_client, 'localhost', self.port):
            print('Server running. Waiting for clients...')
            
            # Wait for first client to connect
            while not self.clients:
                await asyncio.sleep(0.5)

            print('Client connected! Starting replay...')
            await self.replay_messages()

            # Keep server running and restart replay for new clients
            while not self.shutdown_event.is_set():
                await asyncio.sleep(1)

    async def shutdown(self):
        """Gracefully shutdown the server."""
        print()
        print("⚠ Interrupted by user, shutting down gracefully...")
        self.shutdown_event.set()
        
        # Close all client connections
        if self.clients:
            print(f"Closing {len(self.clients)} client connection(s)...")
            for client in list(self.clients):
                try:
                    await client.close()
                except Exception as e:
                    print(f'Error closing client: {e}')
        
        # Cancel all replay tasks
        if self.replay_tasks:
            print(f"Cancelling {len(self.replay_tasks)} replay task(s)...")
            for task in list(self.replay_tasks):
                if not task.done():
                    task.cancel()
        
            # Wait for tasks to complete
            await asyncio.gather(*self.replay_tasks, return_exceptions=True)
        
        print("✓ Server shutdown complete")


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='NLS Timing WebSocket Replay Server',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  %(prog)s                          # Use newest recording from recordings/
  %(prog)s my_race.json             # Load recordings/my_race.json
  %(prog)s /path/to/file.json       # Load from custom path
  %(prog)s -f my_race.json -s 2.0   # Load with 2x speed
        '''
    )
    
    parser.add_argument(
        'file',
        nargs='?',
        default=None,
        help='Recording file to replay (default: newest in recordings/)'
    )
    
    parser.add_argument(
        '-s', '--speed',
        type=float,
        default=REPLAY_SPEED,
        help=f'Playback speed multiplier (default: {REPLAY_SPEED})'
    )
    
    parser.add_argument(
        '-p', '--port',
        type=int,
        default=REPLAY_PORT,
        help=f'WebSocket port (default: {REPLAY_PORT})'
    )
    
    args = parser.parse_args()
    
    # Determine recording file
    if args.file:
        data_file = args.file
        # If just a filename (no path), look in recordings folder
        if '/' not in data_file and '\\' not in data_file:
            recordings_dir = Path('recordings')
            if recordings_dir.exists():
                candidate = recordings_dir / data_file
                if candidate.exists():
                    data_file = str(candidate)
    else:
        # Find newest file in recordings directory
        recordings_dir = Path('recordings')
        if not recordings_dir.exists():
            print('Error: recordings/ directory not found')
            sys.exit(1)
        
        json_files = list(recordings_dir.glob('*.json'))
        if not json_files:
            print('Error: No recording files found in recordings/')
            sys.exit(1)
        
        # Get newest file by modification time
        data_file = str(max(json_files, key=lambda p: p.stat().st_mtime))
        print(f'Using newest recording: {Path(data_file).name}')
    
    speed = args.speed
    port = args.port

    print('NLS Timing WebSocket Replay Server')
    print(f'Data file: {data_file}')
    print(f'Speed: {speed}x')
    print(f'Port: {port}')
    print('Press Ctrl+C to stop gracefully')
    print()

    server = WebSocketReplayServer(data_file, speed, port)

    if not server.load_data():
        sys.exit(1)

    try:
        await server.start_server()
    except (KeyboardInterrupt, asyncio.CancelledError):
        await server.shutdown()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass  # Shutdown already handled in main()
